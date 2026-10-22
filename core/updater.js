'use strict';
/**
 * 更新器
 * 只替换应用代码（resources/app，约 1 MB），不重下 Electron 运行时，
 * 因此可以直接把更新包挂在 GitHub Release 上（远小于 100 MB 限制）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const AdmZip = require('adm-zip');

const REPO = 'Survaetr/SMUCL';
const API = `https://api.github.com/repos/${REPO}`;
const UA = 'SMUCL-Updater';
const TIMEOUT = 15000;

function versionParts(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((n) => parseInt(n, 10) || 0);
}

/** 返回 a>b 为正，a<b 为负 */
function compareVersion(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickAsset(assets) {
  const list = assets || [];
  // 优先取与当前版本无关的通用命名 app-*.zip
  return (
    list.find((a) => /^app-.*\.zip$/i.test(a.name)) ||
    list.find((a) => /^app\.zip$/i.test(a.name)) ||
    null
  );
}

/**
 * 检查 GitHub 上的最新版本
 * @returns {Promise<{ok:boolean, current?:string, latest?:string, hasUpdate?:boolean, notes?:string, url?:string, asset?:object, error?:string, source?:string}>}
 */
async function check() {
  const current = app.getVersion();
  try {
    let release = null;
    try {
      release = await getJson(`${API}/releases/latest`);
    } catch {
      const list = await getJson(`${API}/releases`).catch(() => []);
      release = Array.isArray(list) ? list.find((r) => !r.draft && !r.prerelease) || list.find((r) => !r.draft) : null;
    }

    if (!release) {
      const tags = await getJson(`${API}/tags`).catch(() => []);
      if (!Array.isArray(tags) || !tags.length) {
        return { ok: false, error: '仓库还没有发布记录' };
      }
      const latest = String(tags[0].name || '').replace(/^v/i, '');
      return {
        ok: true,
        source: 'tag',
        current,
        latest,
        hasUpdate: compareVersion(latest, current) > 0,
        notes: '',
        url: `https://github.com/${REPO}/releases`,
        asset: null,
      };
    }

    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
    return {
      ok: true,
      source: 'release',
      current,
      latest,
      hasUpdate: compareVersion(latest, current) > 0,
      notes: release.body || '',
      name: release.name || `v${latest}`,
      published: release.published_at || null,
      url: release.html_url,
      asset: pickAsset(release.assets),
    };
  } catch (e) {
    return { ok: false, error: `无法连接 GitHub：${e.message}` };
  }
}

function downloadFile(url, dest, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/octet-stream' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = Number(res.headers.get('content-length') || 0);
      const out = fs.createWriteStream(dest);
      let received = 0;

      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        out.write(Buffer.from(value));
        if (onProgress) onProgress(received, total);
      }
      out.end(() => {
        clearTimeout(timer);
        resolve({ bytes: received, total });
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** 当前应用代码目录（打包后为 resources/app） */
function appCodeDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app');
  return path.join(__dirname, '..');
}

/**
 * 下载并安装更新包
 * @param {object} asset {name,url,size}
 * @param {(received:number,total:number)=>void} onProgress
 */
async function install(asset, onProgress) {
  if (!app.isPackaged) {
    throw new Error('开发模式下不支持自动替换，请查看发布页');
  }
  if (!asset || !asset.url) throw new Error('该版本没有提供可自动更新的安装包');

  const tmpZip = path.join(os.tmpdir(), `smucl-update-${Date.now()}.zip`);
  const tmpDir = path.join(os.tmpdir(), `smucl-update-${Date.now()}`);

  await downloadFile(asset.url, tmpZip, onProgress);

  const zip = new AdmZip(tmpZip);
  zip.extractAllTo(tmpDir, true);

  // 兼容两种打包结构：zip 根目录直接是 app 内容，或外面套一层 app/
  let src = tmpDir;
  if (!fs.existsSync(path.join(src, 'main.js'))) {
    const nested = path.join(tmpDir, 'app');
    if (fs.existsSync(path.join(nested, 'main.js'))) src = nested;
  }
  if (!fs.existsSync(path.join(src, 'main.js'))) {
    throw new Error('更新包结构异常（缺少 main.js）');
  }

  const target = appCodeDir();
  fs.cpSync(src, target, { recursive: true, force: true });

  // 清理临时文件
  setTimeout(() => {
    try {
      fs.rmSync(tmpZip, { force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }, 3000);

  return { target, version: app.getVersion() };
}

module.exports = { check, install, compareVersion, REPO };
