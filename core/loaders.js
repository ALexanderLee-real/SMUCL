'use strict';
/**
 * 模组加载器安装
 *
 * Fabric / Quilt：官方 meta 接口直接返回一份完整的版本 JSON（含 mainClass 与 libraries），
 *   写进 versions/<id>/<id>.json 再把库下下来即可，全程不需要 Java。
 *
 * Forge / NeoForge：没有纯 JSON 方案，必须下载官方 installer.jar 并执行
 *   `java -jar installer.jar --installClient <游戏目录>`，由它跑完 processors 生成补丁后的客户端 jar。
 *   installer 还要求目录里存在 launcher_profiles.json，否则直接拒绝安装。
 *
 * 双源：bmcl（BMCLAPI 镜像，默认） / mojang（官方）。
 * 实测 maven.neoforged.net 在部分网络下会被 DNS 污染（解析到 31.13.84.2），官方源基本不可用。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const net = require('./net');

const BMCL = 'https://bmclapi2.bangbang93.com';

const PROVIDERS = {
  fabric: {
    label: 'Fabric',
    kind: 'json',
    list: (mc, src) =>
      src === 'bmcl'
        ? `${BMCL}/fabric-meta/v2/versions/loader/${encodeURIComponent(mc)}`
        : `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
    profile: (mc, lv, src) =>
      src === 'bmcl'
        ? `${BMCL}/fabric-meta/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`
        : `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`,
    libBase: (src) => (src === 'bmcl' ? `${BMCL}/maven/` : 'https://maven.fabricmc.net/'),
    rewrite: (url, src) =>
      src === 'bmcl' && url.includes('maven.fabricmc.net')
        ? url.replace(/^https?:\/\/maven\.fabricmc\.net\/?/, `${BMCL}/maven/`)
        : url,
  },
  quilt: {
    label: 'Quilt',
    kind: 'json',
    // BMCLAPI 没有镜像 Quilt，只能走官方
    list: (mc) => `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`,
    profile: (mc, lv) =>
      `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`,
    libBase: () => 'https://maven.quiltmc.org/repository/release/',
    rewrite: (url) => url,
  },
  forge: {
    label: 'Forge',
    kind: 'installer',
    list: (mc, src) =>
      src === 'bmcl'
        ? `${BMCL}/forge/minecraft/${encodeURIComponent(mc)}`
        : 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
    installer: (mc, lv, src) =>
      src === 'bmcl'
        ? `${BMCL}/maven/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`
        : `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`,
  },
  neoforge: {
    label: 'NeoForge',
    kind: 'installer',
    list: (mc, src) =>
      src === 'bmcl'
        ? `${BMCL}/neoforge/list/${encodeURIComponent(mc)}`
        : 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
    installer: (mc, lv, src) =>
      src === 'bmcl'
        ? `${BMCL}/maven/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`
        : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`,
  },
};

function parseXmlVersions(xml) {
  return Array.from(String(xml).matchAll(/<version>([^<]+)<\/version>/g)).map((m) => m[1].trim());
}

/** NeoForge 版本号形如 21.1.234，对应 MC 1.21.1 */
function neoforgeMatches(mc, ver) {
  const base = mc.replace(/^1\./, '');
  return ver === base || ver.startsWith(base + '.');
}

/** 版本号降序比较（按数字段） */
function compareVer(a, b) {
  const pa = String(a).split(/[^\d]+/).filter(Boolean).map(Number);
  const pb = String(b).split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 把不同来源的返回统一成 [{version, stable}]，新的在前 */
function normalizeList(loader, mc, data, src) {
  const p = PROVIDERS[loader];

  if (p.kind === 'json') {
    return (Array.isArray(data) ? data : [])
      .map((x) => ({
        version: x.loader && x.loader.version,
        stable: Boolean(x.loader && x.loader.stable),
      }))
      .filter((x) => x.version);
  }

  if (src === 'bmcl') {
    return (Array.isArray(data) ? data : [])
      .map((x) => ({ version: x.version, stable: true }))
      .filter((x) => x.version && (loader === 'neoforge' ? neoforgeMatches(mc, x.version) : true))
      .sort((a, b) => compareVer(a.version, b.version));
  }

  // 官方 maven-metadata.xml：版本号带 MC 前缀
  const prefix = loader === 'forge' ? `${mc}-` : mc.replace(/^1\./, '') + '.';
  return parseXmlVersions(data)
    .filter((v) => (loader === 'forge' ? v.startsWith(prefix) : neoforgeMatches(mc, v)))
    .map((v) => ({ version: loader === 'forge' ? v.slice(prefix.length) : v, stable: true }))
    .reverse();
}

async function listVersions(loader, mcVersion, source = 'bmcl') {
  const p = PROVIDERS[loader];
  if (!p) return { ok: false, error: `未知的加载器：${loader}` };
  if (!mcVersion) return { ok: false, error: '请先选择游戏版本' };

  const src = loader === 'quilt' ? 'mojang' : source;

  try {
    const data = await net.fetchJson(p.list(mcVersion, src), {
      raw: p.kind === 'installer' && src !== 'bmcl',
      timeout: 20000,
    });
    const list = normalizeList(loader, mcVersion, data, src).slice(0, 80);
    if (!list.length) return { ok: false, error: `${p.label} 没有适用于 ${mcVersion} 的版本` };
    return { ok: true, data: list, source: src };
  } catch (e) {
    const hint = src === 'bmcl' ? '（镜像）' : '（官方源，可能被网络拦截）';
    return { ok: false, error: `${p.label} 版本列表获取失败${hint}：${e.message}` };
  }
}

/** group:artifact:version[:classifier][@ext] → 相对路径 */
function mavenRel(name) {
  const [coord, ext] = String(name).split('@');
  const [group, artifact, version, classifier] = coord.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext || 'jar'}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

function libraryUrl(lib, provider, src) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.url) {
    return { url: provider.rewrite(lib.downloads.artifact.url, src), rel: lib.downloads.artifact.path };
  }
  const rel = mavenRel(lib.name);
  const root = provider.rewrite((lib.url || provider.libBase(src)).replace(/\/?$/, '/'), src);
  return { url: root + rel, rel };
}

/**
 * 一个依赖给出多个候选地址：
 *   镜像地址 → 声明的官方地址 → Maven Central
 * 镜像偶尔缺件或抽风，靠回退把成功率拉回来（asm、guava 这类公共库 Central 一定有）
 */
function candidateUrls(lib, provider, src, rel, primary) {
  const list = [primary];
  const declared =
    (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.url) ||
    (lib.url ? String(lib.url).replace(/\/?$/, '/') + rel : '');
  if (declared && !list.includes(declared)) list.push(declared);
  const central = `https://repo1.maven.org/maven2/${rel}`;
  if (!list.includes(central)) list.push(central);
  return list;
}

async function downloadLibraries(libs, gameDir, provider, src, onProgress) {
  const tasks = [];
  for (const lib of libs || []) {
    if (!lib.name) continue;
    const { url, rel } = libraryUrl(lib, provider, src);
    tasks.push({
      urls: candidateUrls(lib, provider, src, rel, url),
      dest: path.join(gameDir, 'libraries', rel),
      name: lib.name,
    });
  }

  let done = 0;
  const failed = [];
  // 并发别开太大：海外 maven + 镜像混用，8 路容易互相挤掉超时
  await net.pool(tasks, 4, async (t) => {
    let lastErr = null;
    for (const u of t.urls) {
      try {
        await net.download(u, t.dest, { retries: 1, timeout: 45000 });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) failed.push({ name: t.name, error: lastErr.message });
    done++;
    if (onProgress && (done % 3 === 0 || done === tasks.length)) {
      onProgress({ stage: 'libs', done, total: tasks.length });
    }
  });

  return { total: tasks.length, failed };
}

/** Fabric / Quilt：纯 HTTP 安装 */
async function installJson(loader, mcVersion, loaderVersion, gameDir, src, onProgress) {
  const p = PROVIDERS[loader];
  const report = (patch) => onProgress && onProgress(patch);

  report({ stage: 'meta', message: `获取 ${p.label} ${loaderVersion} 信息` });
  const profile = await net.fetchJson(p.profile(mcVersion, loaderVersion, src), { timeout: 25000 });
  if (!profile || !profile.id) throw new Error('接口返回的版本信息不完整');

  const id = profile.id;
  const dir = path.join(gameDir, 'versions', id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(profile, null, 2), 'utf8');

  report({ stage: 'libs', message: `下载 ${p.label} 依赖库` });
  const { total, failed } = await downloadLibraries(profile.libraries, gameDir, p, src, report);
  if (failed.length) throw new Error(`${failed.length}/${total} 个依赖库下载失败，例如 ${failed[0].name}`);

  return { id, mcVersion, loaderVersion, libs: total };
}

function probeJava(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: err.message });
      const m = (String(stderr) + String(stdout)).match(/version "([^"]+)"/);
      resolve({ ok: true, version: m ? m[1] : '' });
    });
  });
}

/** Forge / NeoForge：下载 installer 并执行 */
async function installWithInstaller(loader, mcVersion, loaderVersion, gameDir, javaPath, src, onProgress) {
  const p = PROVIDERS[loader];
  const report = (patch) => onProgress && onProgress(patch);

  if (!javaPath) throw new Error('没有可用的 Java，无法运行安装器');
  const probe = await probeJava(javaPath);
  if (!probe.ok) throw new Error(`Java 无法运行：${probe.error}`);

  const url = p.installer(mcVersion, loaderVersion, src);
  const tmp = path.join(os.tmpdir(), `smucl-${loader}-${Date.now()}.jar`);

  report({ stage: 'download', message: `下载 ${p.label} 安装器` });
  await net.download(url, tmp, { retries: 3, timeout: 180000 });

  // installer 要求目录里有 launcher_profiles.json，否则直接拒绝安装
  const profiles = path.join(gameDir, 'launcher_profiles.json');
  let stubCreated = false;
  if (!fs.existsSync(profiles)) {
    await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2), 'utf8');
    stubCreated = true;
  }

  report({ stage: 'install', message: `${p.label} 安装器运行中，首次安装要跑几分钟，请不要关闭窗口` });

  try {
    const out = await new Promise((resolve, reject) => {
      execFile(
        javaPath,
        ['-jar', tmp, '--installClient', gameDir],
        { cwd: gameDir, windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const text = `${stdout || ''}\n${stderr || ''}`;
          if (err) return reject(Object.assign(new Error(err.message), { text }));
          resolve(text);
        }
      );
    });

    if (out.includes('There is no minecraft launcher profile') || /Failed to install/i.test(out)) {
      throw new Error('安装器报告失败，多半是 Java 版本不匹配');
    }
  } finally {
    if (stubCreated) {
      try {
        fs.unlinkSync(profiles);
      } catch {
        /* 只是个占位文件，删不掉也不影响 */
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件清不掉不影响结果 */
    }
  }

  // installer 正常退出不代表成功，得确认版本目录真的生成了
  const versionsDir = path.join(gameDir, 'versions');
  const candidates = fs
    .readdirSync(versionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return { id: e.name, mtime: fs.statSync(path.join(versionsDir, e.name, `${e.name}.json`)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((v) => v.id.toLowerCase().includes(loader))
    .sort((a, b) => b.mtime - a.mtime);

  const recent = candidates.find((v) => Date.now() - v.mtime < 20 * 60 * 1000);
  if (!recent) throw new Error('安装器执行完毕，但没有找到新生成的版本目录');

  return { id: recent.id, mcVersion, loaderVersion, libs: 0 };
}

async function install({ loader, mcVersion, loaderVersion, gameDir, javaPath, source = 'bmcl', onProgress }) {
  const p = PROVIDERS[loader];
  if (!p) return { ok: false, error: `未知的加载器：${loader}` };
  if (!mcVersion || !loaderVersion) return { ok: false, error: '游戏版本与加载器版本都必须选择' };

  const baseJson = path.join(gameDir, 'versions', mcVersion, `${mcVersion}.json`);
  if (!fs.existsSync(baseJson)) {
    return { ok: false, error: `还没有安装原版 ${mcVersion}，请先在列表里下载它，再装 ${p.label}` };
  }

  const src = loader === 'quilt' ? 'mojang' : source;

  try {
    const r =
      p.kind === 'json'
        ? await installJson(loader, mcVersion, loaderVersion, gameDir, src, onProgress)
        : await installWithInstaller(loader, mcVersion, loaderVersion, gameDir, javaPath, src, onProgress);
    return { ok: true, data: { ...r, label: p.label } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { listVersions, install, PROVIDERS, mavenRel };
