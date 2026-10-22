'use strict';
/**
 * 网络层：JSON 拉取 + 断点安全的文件下载 + 并发池。
 * 只依赖 Node 22 内置的 fetch。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const UA = 'SMUCL/1.0 (+https://mc.sjtu.cn) Electron';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, { timeout = 25000, retries = 2, raw = false, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: raw ? '*/*' : 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // raw: 拿纯文本（XML 之类），默认按 JSON 解析
      return raw ? await res.text() : await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(400 * (i + 1));
    }
  }
  throw new Error(`请求失败 ${url} — ${lastErr && lastErr.message}`);
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

/**
 * 下载单个文件。已存在且大小一致则跳过（增量安装的关键）。
 * @returns {Promise<{size:number, skipped:boolean}>}
 */
async function download(url, dest, opts = {}) {
  const { expectedSize = 0, retries = 3, onBytes = null, timeout = 30000 } = opts;

  const existing = fileSize(dest);
  if (existing > 0 && (!expectedSize || existing === expectedSize)) {
    if (onBytes) onBytes(existing);
    return { size: existing, skipped: true };
  }

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const handle = await fsp.open(tmp, 'w');
      let received = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await handle.write(value);
          received += value.length;
          if (onBytes) onBytes(value.length);
        }
      } finally {
        await handle.close();
      }
      await fsp.rename(tmp, dest);
      return { size: received, skipped: false };
    } catch (e) {
      lastErr = e;
      try {
        await fsp.unlink(tmp);
      } catch {}
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`下载失败 ${path.basename(dest)} — ${lastErr && lastErr.message}`);
}

/** 受控并发执行，避免把带宽和句柄打满 */
async function pool(items, limit, worker) {
  const queue = items.slice();
  const runners = new Array(Math.min(limit, queue.length)).fill(0).map(async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

module.exports = { fetchJson, download, pool, fileSize, sleep, UA };
