'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const settingsLib = require('./core/settings');
const javaLib = require('./core/java');
const versionLib = require('./core/version');
const installer = require('./core/install');
const launcher = require('./core/launch');
const dirsLib = require('./core/dirs');
const savesLib = require('./core/saves');
const updater = require('./core/updater');
const gpuLib = require('./core/gpu');
const packLib = require('./core/pack');
const loadersLib = require('./core/loaders');
const modrinthLib = require('./core/modrinth');
const curseforgeLib = require('./core/curseforge');

// Windows 上部分镜像的 AAAA 记录不可达，IPv6 优先会白等十几次超时
try {
  require('dns').setDefaultResultOrder('ipv4first');
} catch {
  /* 旧版本 Node 无此 API，忽略 */
}

const isDev = process.argv.includes('--dev');
let win = null;
let gameProc = null;
const installing = new Map();
let javaCache = [];
let latestInfo = null; // 最新版本信息（后台定时更新）

// ------------------------------------------------------------------ GPU 兼容兜底
// 部分机器（驱动异常、安全软件拦截）会导致 Chromium 的 GPU 进程一启动就崩溃，
// 表现为 "GPU process isn't usable. Goodbye." 并直接退出。
// 这里做两级处理：崩溃后写入标记并带 --no-sandbox 重启；标记存在时开机即走兼容参数。
const FALLBACK_ARG = '--smucl-gpu-fallback';
const isFallbackLaunch = process.argv.includes(FALLBACK_ARG);

settingsLib.init();
const bootSettings = settingsLib.all();

function relaunchCompat() {
  const args = process.argv.slice(1).concat(['--no-sandbox', FALLBACK_ARG]);
  app.relaunch({ args });
  app.exit(0);
}

if (bootSettings.gpuFallback && !isFallbackLaunch) {
  console.log('[gpu] 上次检测到 GPU 崩溃，本次以兼容模式启动');
  relaunchCompat();
}

app.on('child-process-gone', (_e, details) => {
  if (!details || details.type !== 'GPU' || isFallbackLaunch) return;
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;
  if (settingsLib.all().gpuFallback) return;
  console.log('[gpu] GPU 进程异常退出，切换兼容模式重启：', details.reason);
  settingsLib.save({ gpuFallback: true });
  relaunchCompat();
});

// ------------------------------------------------------------------ 窗口
function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 1020,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#0e1118',
    title: 'SMUCL',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 把渲染进程的报错带回主进程日志，便于排查
  win.webContents.on('console-message', (...args) => {
    const d = args[1];
    if (d && typeof d === 'object') {
      if (d.level === 'error' || d.level === 'warning') console.log(`[renderer:${d.level}]`, d.message);
    } else if (args[1] >= 2) {
      console.log('[renderer]', args[2]);
    }
  });
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.on('closed', () => {
    win = null;
  });

  // 开发辅助：SMUCL_SHOT=1 [SMUCL_SHOT_VIEW=download] 自动截图后退出，便于核对界面
  const shotMode = process.env.SMUCL_SHOT === '1' || process.argv.includes('--shot');
  if (shotMode) {
    const view = process.env.SMUCL_SHOT_VIEW || null;
    win.webContents.once('did-finish-load', () => {
      const delay = view === 'download' ? 12000 : view === 'saves' ? 9000 : 3000;
      setTimeout(async () => {
        try {
          if (view) {
            await win.webContents.executeJavaScript(
              `document.querySelector('[data-view="${view}"]')?.click(); true`
            );
            await new Promise((r) => setTimeout(r, 1600));
          }
          // 调试钩子：注入一段脚本后再截图，便于自动化验证交互
          if (process.env.SMUCL_SHOT_JS) {
            await win.webContents.executeJavaScript(process.env.SMUCL_SHOT_JS);
            await new Promise((r) => setTimeout(r, 2500));
          }
          const img = await win.webContents.capturePage();
          const name = view ? `shot-${view}.png` : 'shot.png';
          const outDir = path.join(__dirname, 'build');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, name), img.toPNG());
          console.log('[shot] saved', name);
        } catch (e) {
          console.error('[shot] failed', e);
        }
        app.quit();
      }, delay);
    });
  }

  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ------------------------------------------------------------------ 目录与状态
function getDirs() {
  return dirsLib.all(settingsLib.all());
}

function appState() {
  const settings = settingsLib.all();
  const dirs = getDirs();
  const installed = versionLib.listInstalled(dirs);
  return {
    settings,
    javaList: javaCache,
    dirs,
    installed,
    latest: latestInfo,
    gpuFallback: Boolean(settingsLib.all().gpuFallback),
    fallbackActive: isFallbackLaunch,
    platform: process.platform,
    version: app.getVersion(),
    memoryTotal: Math.round(os.totalmem() / 1024 / 1024),
  };
}

async function refreshJava() {
  const settings = settingsLib.all();
  const mcDirs = getDirs().map((d) => d.path);
  javaCache = await javaLib.detect({
    mcDir: settings.mcDir,
    mcDirs,
    preferred: settings.javaPath,
  });
  return javaCache;
}

/** 后台检查最新版本；发现变化时推送给渲染进程 */
async function checkLatest(notify = true) {
  const { downloadSource, autoCheck } = settingsLib.all();
  if (!autoCheck && notify) return latestInfo;
  try {
    const data = await versionLib.getManifest(downloadSource, { force: true });
    const next = {
      release: data.latest.release,
      snapshot: data.latest.snapshot,
      source: data.__source || downloadSource,
      at: Date.now(),
    };
    const changed =
      !latestInfo || latestInfo.release !== next.release || latestInfo.snapshot !== next.snapshot;
    latestInfo = next;
    if (changed && notify && win && !win.isDestroyed()) {
      win.webContents.send('manifest:latest', next);
      // 窗口不在前台时补一条系统通知
      if (!win.isFocused() && Notification.isSupported()) {
        try {
          const n = new Notification({
            title: 'SMUCL · 发现新版本',
            body: `Minecraft ${next.release} 已发布，点击启动器即可安装`,
            silent: true,
          });
          n.on('click', () => {
            if (!win) return;
            if (win.isMinimized()) win.restore();
            win.focus();
          });
          n.show();
        } catch {
          /* 通知不可用则忽略 */
        }
      }
    }
    return next;
  } catch {
    return latestInfo;
  }
}

/** 首次启动：若默认目录没有实例，自动采用检测到的 PCL 目录 */
function adoptLauncherDirIfNeeded() {
  const configFile = path.join(app.getPath('userData'), 'smucl-config.json');
  if (fs.existsSync(configFile)) return;

  const count = (p) => {
    try {
      return fs
        .readdirSync(path.join(p, 'versions'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(p, 'versions', e.name, `${e.name}.json`)))
        .length;
    } catch {
      return 0;
    }
  };

  const settings = settingsLib.all();
  if (count(settings.mcDir) > 0) return;

  const roots = dirsLib.findLauncherRoots();
  for (const r of roots) {
    const mc = path.join(r.dir, '.minecraft');
    if (count(mc) > 0) {
      settingsLib.save({ mcDir: mc });
      console.log('[init] 已采用游戏目录:', mc);
      return;
    }
  }
}

// ------------------------------------------------------------------ IPC
function registerIpc() {
  ipcMain.handle('app:state', async () => {
    // 首屏不等 Java 扫描与体积统计
    return { ok: true, data: appState() };
  });

  ipcMain.handle('java:detect', async () => {
    try {
      await refreshJava();
      return { ok: true, data: javaCache };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('versions:manifest', async (_e, { force = false } = {}) => {
    const { downloadSource } = settingsLib.all();
    try {
      const data = await versionLib.getManifest(downloadSource, { force });
      latestInfo = {
        release: data.latest.release,
        snapshot: data.latest.snapshot,
        source: data.__source || downloadSource,
        at: Date.now(),
      };
      return {
        ok: true,
        data: {
          latest: data.latest,
          source: latestInfo.source,
          checkedAt: latestInfo.at,
          versions: data.versions.map((v) => ({
            id: v.id,
            type: v.type,
            releaseTime: v.releaseTime,
            url: v.url,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: `版本列表获取失败：${e.message}` };
    }
  });

  ipcMain.handle('versions:installed', async () => {
    return { ok: true, data: versionLib.listInstalled(getDirs()) };
  });

  // 体积统计耗时较长，逐个推送给界面
  ipcMain.handle('versions:sizes', async () => {
    const installed = versionLib.listInstalled(getDirs());
    const map = {};
    for (const v of installed) {
      const p = path.join(v.dir, 'versions', v.id);
      const size = await savesLib.dirSize(p);
      const key = `${v.dir}|${v.id}`;
      map[key] = size;
      if (win && !win.isDestroyed()) win.webContents.send('versions:size', { key, size });
    }
    return { ok: true, data: map };
  });

  // ---------------- 游戏目录管理 ----------------
  ipcMain.handle('dirs:list', async () => {
    return { ok: true, data: { dirs: getDirs(), settings: settingsLib.all(), installed: versionLib.listInstalled(getDirs()) } };
  });

  ipcMain.handle('dirs:add', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择 .minecraft 目录（包含 versions/saves 的文件夹）',
    });
    if (res.canceled || !res.filePaths[0]) return { ok: true, data: null };
    const picked = res.filePaths[0];
    const settings = settingsLib.all();
    const extra = Array.from(new Set([...(settings.extraDirs || []), picked]));
    settingsLib.save({ extraDirs: extra });
    return { ok: true, data: { dirs: getDirs(), installed: versionLib.listInstalled(getDirs()), settings: settingsLib.all() } };
  });

  ipcMain.handle('dirs:remove', async (_e, { path: target }) => {
    const settings = settingsLib.all();
    const extra = (settings.extraDirs || []).filter((p) => dirsLib.norm(p) !== dirsLib.norm(target));
    settingsLib.save({ extraDirs: extra });
    return { ok: true, data: { dirs: getDirs(), installed: versionLib.listInstalled(getDirs()), settings: settingsLib.all() } };
  });

  ipcMain.handle('dirs:setPrimary', async (_e, { path: target }) => {
    if (!target) return { ok: false, error: '缺少目录' };
    const settingsLibNext = settingsLib.save({ mcDir: target });
    settingsLib.ensureGameDir();
    await refreshJava().catch(() => {});
    return {
      ok: true,
      data: { dirs: getDirs(), installed: versionLib.listInstalled(getDirs()), settings: settingsLibNext },
    };
  });

  // ---------------- 存档 ----------------
  ipcMain.handle('saves:list', async () => {
    const dirs = getDirs();
    try {
      const list = await savesLib.scan(dirs, (done, total) => {
        if (win && !win.isDestroyed()) win.webContents.send('saves:progress', { done, total });
      });
      return { ok: true, data: { saves: list, dirs } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('saves:reveal', async (_e, { path: p }) => {
    try {
      shell.showItemInFolder(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('saves:trash', async (_e, { path: p }) => {
    try {
      await shell.trashItem(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------------- 安装 / 删除 ----------------
  ipcMain.handle('install:start', async (_e, { id, url }) => {
    if (installing.has(id)) return { ok: false, error: '该版本正在安装中' };
    if (!url) return { ok: false, error: '缺少版本元数据地址' };

    installing.set(id, true);
    const source = settingsLib.all().downloadSource;
    try {
      const result = await installer.install(id, { url }, source, (p) => {
        if (win && !win.isDestroyed()) win.webContents.send('install:progress', p);
      });
      return { ok: true, data: result };
    } catch (e) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('install:progress', { id, stage: 'error', message: e.message, percent: 0 });
      }
      return { ok: false, error: e.message };
    } finally {
      installing.delete(id);
    }
  });

  ipcMain.handle('version:delete', async (_e, { id, dir }) => {
    const base = dir || settingsLib.all().mcDir;
    const target = path.join(base, 'versions', id);
    try {
      if (!fs.existsSync(target)) throw new Error('目录不存在');
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('version:command', async (_e, { id, dir }) => {
    try {
      const built = launcher.build(id, { ...settingsLib.all(), sourceDir: dir });
      return {
        ok: true,
        data: `"${built.java}" ${built.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------------- 启动 ----------------
  ipcMain.handle('game:launch', async (_e, { id, dir }) => {
    if (gameProc) return { ok: false, error: '游戏已在运行中' };
    const settings = settingsLib.all();
    try {
      const meta = versionLib.loadVersionJson(dir || settings.mcDir, id);

      if (!javaCache.length) await refreshJava().catch(() => {});
      const required = (meta.javaVersion && meta.javaVersion.majorVersion) || 8;
      const preferred = settings.javaPath
        ? javaCache.find((j) => j.java === settings.javaPath || j.path === settings.javaPath)
        : null;
      const picked = preferred || javaLib.pick(javaCache, required);

      if (!picked) {
        return {
          ok: false,
          error: '未检测到可用的 Java 运行时，请先在「设置 → Java 运行时」中指定 javaw.exe 路径',
        };
      }

      const runtime = { ...settings, javaPath: picked.path, sourceDir: dir };
      if (picked.major !== required && win && !win.isDestroyed()) {
        win.webContents.send('game:log', {
          line: `> 提示：${id} 需要 Java ${required}，当前使用 Java ${picked.major}，可能无法正常启动`,
        });
      }

      const proc = launcher.launch(id, runtime, {
        onLog: (line) => win && !win.isDestroyed() && win.webContents.send('game:log', { line }),
        onError: (err) => win && !win.isDestroyed() && win.webContents.send('game:error', { message: err.message }),
        onExit: (code) => {
          gameProc = null;
          if (win && !win.isDestroyed()) win.webContents.send('game:exit', { code });
        },
      });

      gameProc = proc.child;
      return {
        ok: true,
        data: { pid: proc.pid, java: picked, required, command: proc.command },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('game:kill', async () => {
    if (!gameProc) return { ok: false, error: '没有正在运行的游戏' };
    try {
      gameProc.kill();
      gameProc = null;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('settings:save', async (_e, patch) => {
    const next = settingsLib.save(patch);
    if (patch.javaPath !== undefined && patch.javaPath !== null) {
      await refreshJava().catch(() => {});
    }
    return { ok: true, data: next };
  });

  // ---------------- 应用自身的更新 ----------------
  ipcMain.handle('update:check', async (_e, { silent = false } = {}) => {
    const r = await updater.check();
    if (r.ok && r.hasUpdate && win && !win.isDestroyed()) {
      win.webContents.send('update:available', r);
    } else if (!r.ok && !silent && win && !win.isDestroyed()) {
      win.webContents.send('update:failed', r);
    }
    return r;
  });

  ipcMain.handle('update:install', async (_e, { asset }) => {
    try {
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', { stage: 'download', percent: 0 });
      await updater.install(asset, (received, total) => {
        const percent = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
        if (win && !win.isDestroyed()) {
          win.webContents.send('update:progress', { stage: 'download', percent, received, total });
        }
      });
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', { stage: 'done', percent: 100 });
      settingsLib.save({ lastSeenVersion: '', pendingUpdate: true });
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1200);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:info', async () => ({
    ok: true,
    data: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      repo: updater.REPO,
      electron: process.versions.electron,
    },
  }));

  // ---------------- 显卡偏好 ----------------
  // 把每个实例实际会用到的 javaw.exe 写进 Windows 图形设置，让 MC 走独立显卡。
  ipcMain.handle('gpu:applyAll', async (_e, { mode = 'high' } = {}) => {
    if (!gpuLib.supported()) return { ok: false, error: '该功能仅支持 Windows' };
    if (!(mode in gpuLib.MODES)) return { ok: false, error: `未知的显卡模式：${mode}` };
    try {
      if (!javaCache.length) await refreshJava().catch(() => {});
      const settings = settingsLib.all();
      const installed = versionLib.listInstalled(getDirs());
      const exePaths = [];
      const versions = [];

      for (const v of installed) {
        // listInstalled 已经把 javaVersion.majorVersion 读出来了，不必再解析一遍 JSON
        const required = v.javaMajor || 8;
        const preferred = settings.javaPath
          ? javaCache.find((j) => j.java === settings.javaPath || j.path === settings.javaPath)
          : null;
        const picked = preferred || javaLib.pick(javaCache, required);
        if (!picked) continue;
        exePaths.push(picked.path);
        versions.push({ id: v.id, java: picked.path, required, actual: picked.major });
      }

      // 没有实例时，至少把手动指定的 Java 也写进去
      if (settings.javaPath) exePaths.push(settings.javaPath);

      const result = await gpuLib.applyAll(exePaths, mode);
      return { ok: true, data: { ...result, versions, count: versions.length } };
    } catch (e) {
      return { ok: false, error: gpuLib.friendly(e) };
    }
  });

  ipcMain.handle('dialog:pickDir', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择目录',
    });
    return { ok: true, data: res.canceled ? null : res.filePaths[0] };
  });

  ipcMain.handle('dialog:pickJava', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: '选择 javaw.exe',
      filters: [{ name: 'Java 可执行文件', extensions: ['exe'] }],
    });
    return { ok: true, data: res.canceled ? null : res.filePaths[0] };
  });

  // ---------------- 整合包（Modrinth / CurseForge） ----------------
  /** 按版本号从 Mojang 清单里找原版下载地址，整合包要拿它补底座 */
  const vanillaUrl = async (mcVersion) => {
    try {
      const data = await versionLib.getManifest(settingsLib.all().downloadSource, {});
      const hit = (data.versions || []).find((v) => v.id === mcVersion);
      return hit ? hit.url : '';
    } catch {
      return '';
    }
  };

  /** 按原版要求挑 Java，安装器要用 java.exe 才能拿到输出 */
  const javaFor = async (mcVersion) => {
    const settings = settingsLib.all();
    let required = 17;
    try {
      const meta = versionLib.loadVersionJson(settings.mcDir, mcVersion);
      required = (meta.javaVersion && meta.javaVersion.majorVersion) || 17;
    } catch {
      /* 元数据读不到就按 17 兜底 */
    }
    if (!javaCache.length) await refreshJava().catch(() => {});
    const preferred = settings.javaPath
      ? javaCache.find((j) => j.java === settings.javaPath || j.path === settings.javaPath)
      : null;
    const picked = preferred || javaLib.pick(javaCache, required);
    return picked ? picked.java || picked.path : '';
  };

  const cfKey = () => settingsLib.all().cfApiKey || '';

  ipcMain.handle('modpack:search', async (_e, { source, query, offset = 0 }) => {
    try {
      if (source === 'curseforge') {
        if (!cfKey()) return { ok: false, needKey: true, error: '需要 CurseForge API Key' };
        return { ok: true, data: await curseforgeLib.search(cfKey(), query, { offset }) };
      }
      return { ok: true, data: await modrinthLib.search(query, { offset }) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modpack:versions', async (_e, { source, projectId }) => {
    try {
      if (source === 'curseforge') {
        if (!cfKey()) return { ok: false, needKey: true, error: '需要 CurseForge API Key' };
        return { ok: true, data: await curseforgeLib.files(cfKey(), projectId) };
      }
      return { ok: true, data: await modrinthLib.versions(projectId) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modpack:install', async (_e, { source, downloadUrl, fileName, mcVersion }) => {
    const send = (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('modpack:progress', p);
    };
    try {
      const baseUrl = await vanillaUrl(mcVersion);
      const javaPath = await javaFor(mcVersion);
      const common = {
        gameDir: settingsLib.all().mcDir,
        downloadUrl,
        fileName,
        javaPath,
        source: settingsLib.all().downloadSource === 'mojang' ? 'mojang' : 'bmcl',
        baseUrl,
        onProgress: send,
      };
      const r =
        source === 'curseforge'
          ? await curseforgeLib.installVersion({ ...common, apiKey: cfKey() })
          : await modrinthLib.installVersion(common);
      if (r.ok) send({ stage: 'done', message: '安装完成', percent: 100 });
      return r;
    } catch (e) {
      send({ stage: 'error', message: e.message });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modpack:setKey', async (_e, { key }) => {
    const r = await settingsLib.save({ cfApiKey: String(key || '').trim() });
    return { ok: true, data: r };
  });

  // ---------------- 模组加载器 ----------------
  const sourceOf = () => (settingsLib.all().downloadSource === 'mojang' ? 'mojang' : 'bmcl');

  ipcMain.handle('loader:list', async (_e, { loader, mc }) => {
    try {
      return await loadersLib.listVersions(loader, mc, sourceOf());
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('loader:install', async (_e, { loader, mc, loaderVersion, url }) => {
    const settings = settingsLib.all();
    const gameDir = settings.mcDir;

    const send = (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('loader:progress', p);
    };

    // 底座没装就先补原版，否则加载器装完也启动不了
    const baseJson = path.join(gameDir, 'versions', mc, `${mc}.json`);
    if (!fs.existsSync(baseJson)) {
      if (!url) return { ok: false, error: `还没有安装原版 ${mc}，请先在下方列表里下载` };
      send({ stage: 'base', message: `先补装原版 ${mc}` });
      try {
        await installer.install(mc, { url }, sourceOf(), (p) => {
          if (p && p.stage) send({ stage: 'base', percent: p.percent, message: `原版 ${mc}：${p.message || ''}` });
        });
      } catch (e) {
        send({ stage: 'error', message: `原版安装失败：${e.message}` });
        return { ok: false, error: `原版安装失败：${e.message}` };
      }
    }

    // 按原版声明的 javaVersion 挑合适的运行时；安装器必须用 java.exe 才能拿到输出
    let required = 17;
    try {
      const meta = versionLib.loadVersionJson(gameDir, mc);
      required = (meta.javaVersion && meta.javaVersion.majorVersion) || 17;
    } catch {
      /* 元数据读不到就按 17 兜底 */
    }
    if (!javaCache.length) await refreshJava().catch(() => {});
    const preferred = settings.javaPath
      ? javaCache.find((j) => j.java === settings.javaPath || j.path === settings.javaPath)
      : null;
    const picked = preferred || javaLib.pick(javaCache, required);
    const javaPath = picked ? picked.java || picked.path : '';

    try {
      const r = await loadersLib.install({
        loader,
        mcVersion: mc,
        loaderVersion,
        gameDir,
        javaPath,
        source: sourceOf(),
        onProgress: send,
      });
      if (r.ok) send({ stage: 'done', message: '安装完成', id: r.data.id });
      return r;
    } catch (e) {
      send({ stage: 'error', message: e.message });
      return { ok: false, error: e.message };
    }
  });
  // ---------------- 整合包导入 ----------------
  ipcMain.handle('pack:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: '选择整合包',
      filters: [{ name: '整合包 / 压缩包', extensions: ['zip', 'mrpack'] }],
    });
    return { ok: true, data: res.canceled ? null : res.filePaths[0] };
  });

  ipcMain.handle('pack:inspect', async (_e, { file }) => {
    if (typeof file !== 'string' || !file) return { ok: false, error: '没有拿到有效的整合包路径' };
    try {
      return packLib.inspect(file);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('pack:import', async (_e, { file, targetDir }) => {
    if (typeof file !== 'string' || !file) return { ok: false, error: '没有拿到有效的整合包路径' };
    try {
      const dir = targetDir || settingsLib.all().mcDir;
      const r = await packLib.importPack({ zipPath: file, targetDir: dir });
      if (r.ok) {
        // 导入后重新扫一遍，让列表立刻出现新实例
        await refreshJava().catch(() => {});
      }
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('open:path', async (_e, { target }) => {
    try {
      const resolved = target === 'game' ? settingsLib.all().mcDir : target;
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
      await shell.openPath(resolved);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('open:url', async (_e, { url }) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '非法链接' };
    await shell.openExternal(url);
    return { ok: true };
  });

  // 无边框窗口控制
  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:maximize', () => {
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('win:close', () => win && win.close());
}

// ------------------------------------------------------------------ 生命周期
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('cn.edu.shmtu.smucl');
    settingsLib.ensureGameDir();
    adoptLauncherDirIfNeeded();
    registerIpc();
    createWindow();

    // 启动后延迟检查一次最新版本，之后每 5 分钟一次
    setTimeout(() => checkLatest(false), 4000);
    setInterval(() => {
      if (settingsLib.all().autoCheck) checkLatest(true);
    }, 5 * 60 * 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
