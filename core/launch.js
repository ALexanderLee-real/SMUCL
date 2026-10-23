'use strict';
/**
 * 启动参数构建与进程管理。
 * 兼容两种版本格式：新版 arguments 与旧版 minecraftArguments。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const versionLib = require('./version');
const rules = require('./rules');
const settingsLib = require('./settings');

const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';

function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  // 按 UUID v3 规范改写版本位，保证与主流启动器一致
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 因为继承了父版本，客户端 jar 可能落在父版本目录 */
function resolveClientJar(mcDir, id, meta) {
  const own = path.join(mcDir, 'versions', id, `${id}.jar`);
  if (fs.existsSync(own)) return own;
  if (meta.inheritsFrom) {
    const parent = path.join(mcDir, 'versions', meta.inheritsFrom, `${meta.inheritsFrom}.jar`);
    if (fs.existsSync(parent)) return parent;
  }
  // 兜底：扫描同目录下任意 jar
  const dir = path.join(mcDir, 'versions', id);
  try {
    const jar = fs.readdirSync(dir).find((f) => f.endsWith('.jar'));
    if (jar) return path.join(dir, jar);
  } catch {}
  return own;
}

// 版本 JSON 里的 natives 分类器常常只写了 os.name，没写 arch，
// 三个架构的包会同时命中；这里按当前架构再筛一遍，避免加载到 arm64/x86 的 DLL。
function nativesAllowed(name) {
  const cls = String(name || '').split(':')[3];
  if (!cls || !cls.startsWith('natives-')) return true;
  const body = cls.slice('natives-'.length);
  if (OS_NAME === 'windows') {
    if (!body.startsWith('windows')) return false;
    const arch = body.slice('windows'.length).replace(/^-/, '');
    if (!arch) return process.arch === 'x64';
    if (arch === 'x86') return process.arch === 'ia32';
    if (arch === 'arm64') return process.arch === 'arm64';
    return false;
  }
  if (OS_NAME === 'osx') {
    if (!body.startsWith('macos')) return false;
    return body.endsWith('arm64') ? process.arch === 'arm64' : process.arch !== 'arm64';
  }
  if (!body.startsWith(OS_NAME)) return false;
  const arch = body.slice(OS_NAME.length).replace(/^-/, '');
  if (!arch) return process.arch === 'x64';
  if (arch === 'arm64') return process.arch === 'arm64';
  if (arch === 'arm32') return process.arch === 'arm';
  return true;
}

/**
 * 返回 { classpath, nativeJars }：natives 包不进 classpath，改为解压到 natives 目录，
 * 与官方启动器行为一致（LWJGL 2 只认 java.library.path，不认 classpath）。
 */
function libraryEntries(meta, mcDir) {
  const classpath = [];
  const nativeJars = [];
  for (const lib of meta.libraries || []) {
    if (!rules.allowed(lib.rules, {})) continue;
    const name = lib.name || '';
    if (!nativesAllowed(name)) continue;
    const classifier = String(name).split(':')[3] || '';
    const art = lib.downloads && lib.downloads.artifact;
    if (art && art.path) {
      const p = path.join(mcDir, 'libraries', art.path);
      if (classifier.startsWith('natives-')) nativeJars.push(p);
      else classpath.push(p);
    } else if (!lib.downloads && name) {
      const parts = name.split(':');
      const [g, a, v, c] = parts;
      const file = `${a}-${v}${c ? `-${c}` : ''}.jar`;
      classpath.push(path.join(mcDir, 'libraries', g.replace(/\./g, '/'), a, v, file));
    }
    // 旧版格式：natives 通过 downloads.classifiers 提供，例如 1.12 的 LWJGL 2
    const nativeKey = lib.natives && lib.natives[OS_NAME];
    if (nativeKey) {
      const cls = nativeKey.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const d = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
      if (d && d.path) nativeJars.push(path.join(mcDir, 'libraries', d.path));
    }
  }
  return {
    classpath: classpath.filter((p) => fs.existsSync(p)),
    nativeJars: nativeJars.filter((p) => fs.existsSync(p)),
  };
}

function extractNatives(nativeJars, nativesDir) {
  if (!nativeJars.length) return;
  try {
    fs.mkdirSync(nativesDir, { recursive: true });
  } catch {
    return;
  }
  for (const jar of nativeJars) {
    let zip;
    try {
      zip = new AdmZip(jar);
    } catch {
      continue;
    }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !/\.(dll|so|dylib)$/i.test(entry.entryName)) continue;
      const dest = path.join(nativesDir, path.basename(entry.entryName));
      try {
        if (fs.existsSync(dest) && fs.statSync(dest).size === entry.header.size) continue;
        fs.writeFileSync(dest, entry.getData());
      } catch {
        /* 被占用或无权限时跳过，交给 java.library.path 里已有的 DLL */
      }
    }
  }
}

function findLoggingConfig(mcDir, meta) {
  const id = meta.logging && meta.logging.client && meta.logging.client.file && meta.logging.client.file.id;
  if (!id) return null;
  const p = path.join(mcDir, 'assets', 'log_configs', id);
  return fs.existsSync(p) ? p : null;
}

/** PCL 等启动器会把 natives 解压到 <实例>-natives，优先复用 */
function resolveNativesDir(instanceDir, id) {
  const candidates = [path.join(instanceDir, 'natives'), path.join(instanceDir, `${id}-natives`)];
  for (const p of candidates) {
    try {
      if (fs.readdirSync(p).length > 0) return p;
    } catch {
      /* 不存在就试下一个 */
    }
  }
  const fallback = path.join(instanceDir, 'natives');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

/**
 * 构建完整启动命令
 * @param {string} id 实例名
 * @param {object} options { sourceDir, memory, playerName, javaPath, ... }
 * @returns {{java:string, args:string[], cwd:string, meta:object}}
 */
function build(id, options = {}) {
  const settings = settingsLib.all();
  const mcDir = options.sourceDir || settings.mcDir;
  const meta = versionLib.loadVersionJson(mcDir, id);

  const playerName = (options.playerName || settings.playerName || 'Steve').trim() || 'Steve';
  const memory = Math.max(1024, Number(options.memory || settings.memory || 4096));
  const javaPath = options.javaPath || settings.javaPath;
  const instanceDir = path.join(mcDir, 'versions', id);

  // 版本隔离：mods / config / saves 在实例目录内时，--gameDir 必须指向实例目录
  const isolated = require('./dirs').isIsolatedInstance(instanceDir);
  const gameDir = isolated ? instanceDir : mcDir;
  const nativesDir = resolveNativesDir(instanceDir, id);

  const clientJar = resolveClientJar(mcDir, id, meta);
  const { classpath: libs, nativeJars } = libraryEntries(meta, mcDir);
  const classpath = [clientJar, ...libs].join(path.delimiter);
  extractNatives(nativeJars, nativesDir);

  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(options.resolution && options.resolution.enabled),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };

  const assetsName = (meta.assetIndex && meta.assetIndex.id) || meta.assets || 'legacy';
  // pre-1.6 的资源被安装器映射到 resources/，其余 legacy 索引在 assets/virtual/<id>
  const legacyAssetsRoot =
    assetsName === 'pre-1.6'
      ? path.join(mcDir, 'resources')
      : path.join(mcDir, 'assets', 'virtual', assetsName);

  const replacements = {
    '${auth_player_name}': playerName,
    '${version_name}': id,
    '${game_directory}': gameDir,
    '${assets_root}': path.join(mcDir, 'assets'),
    '${game_assets}': legacyAssetsRoot,
    '${assets_index_name}': assetsName,
    '${auth_uuid}': offlineUuid(playerName),
    '${auth_access_token}': '0',
    '${auth_session}': '0',
    '${clientid}': 'smucl',
    '${auth_xuid}': '0',
    '${user_type}': 'msa',
    '${version_type}': meta.type || 'release',
    '${natives_directory}': nativesDir,
    '${library_directory}': path.join(mcDir, 'libraries'),
    '${classpath_separator}': path.delimiter,
    '${classpath}': classpath,
    '${launcher_name}': 'SMUCL',
    '${launcher_version}': '1.4.1',
    '${user_properties}': '{}',
    '${resolution_width}': String((options.resolution && options.resolution.width) || 925),
    '${resolution_height}': String((options.resolution && options.resolution.height) || 530),
    '${quickPlayPath}': '',
    '${quickPlaySingleplayer}': '',
    '${quickPlayMultiplayer}': '',
    '${quickPlayRealms}': '',
  };

  const apply = (s) => {
    let out = s;
    for (const [k, v] of Object.entries(replacements)) {
      if (out.includes(k)) out = out.split(k).join(v);
    }
    return out;
  };

  // ---- JVM 参数 ----
  const jvm = [];
  const loggingConfig = findLoggingConfig(mcDir, meta);
  const maxMem = memory;
  const minMem = Math.min(1024, Math.floor(memory / 2));

  if (meta.arguments && Array.isArray(meta.arguments.jvm)) {
    const raw = rules.flatten(meta.arguments.jvm, features);
    // 新版 arguments 已包含 -Xmx 的占位符规范，但绝大多数版本没有，这里统一注入
    if (!raw.some((a) => a.startsWith('-Xmx'))) {
      jvm.push(`-Xmx${maxMem}M`, `-Xms${minMem}M`);
    }
    jvm.push(...raw.map(apply));
  } else {
    jvm.push(`-Xmx${maxMem}M`, `-Xms${minMem}M`);
    jvm.push(`-Djava.library.path=${nativesDir}`);
    jvm.push('-cp', classpath);
  }

  if (!jvm.includes('-Dfile.encoding=UTF-8')) {
    jvm.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8');
  }
  if (loggingConfig) {
    jvm.push(`-Dlog4j.configurationFile=${loggingConfig}`);
    jvm.push('-Dlog4j2.formatMsgNoLookups=true');
  }
  if (options.fullscreen) jvm.push('-Dorg.lwjgl.fullscreen=true');

  const extra = (options.jvmArgs || settings.jvmArgs || '').trim();
  if (extra) jvm.push(...extra.split(/\s+/).filter(Boolean));

  // ---- 游戏参数 ----
  let game = [];
  if (meta.arguments && Array.isArray(meta.arguments.game)) {
    game = rules.flatten(meta.arguments.game, features).map(apply);
  } else if (meta.minecraftArguments) {
    game = meta.minecraftArguments.split(/\s+/).filter(Boolean).map(apply);
  }

  if (options.fullscreen && !game.includes('--fullscreen')) game.push('--fullscreen');

  const args = [...jvm, meta.mainClass, ...game];
  const java = javaPath || 'javaw.exe';

  return { java, args, cwd: gameDir, meta, playerName };
}

/**
 * 启动游戏
 * @param {string} id
 * @param {object} options
 * @param {{onLog:(s:string)=>void, onExit:(code:number|null)=>void, onError:(e:Error)=>void}} handlers
 */
function launch(id, options, handlers = {}) {
  const built = build(id, options);
  const { java, args, cwd } = built;

  const child = spawn(java, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pipe = (stream, tag) => {
    if (!stream) return;
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim() && handlers.onLog) handlers.onLog(tag ? `[${tag}] ${line}` : line);
      }
    });
  };

  pipe(child.stdout, '');
  pipe(child.stderr, 'ERR');

  child.on('error', (err) => {
    if (handlers.onError) handlers.onError(err);
  });
  child.on('close', (code) => {
    if (handlers.onExit) handlers.onExit(code);
  });

  return { child, pid: child.pid, command: `${java} ${args.join(' ')}` };
}

module.exports = { launch, build, offlineUuid, extractNatives };
