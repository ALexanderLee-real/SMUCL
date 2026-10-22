'use strict';
/**
 * 存档扫描：兼容三种存放位置
 *   1) <游戏目录>/saves            —— 全局存档
 *   2) <游戏目录>/versions/<id>/saves —— 版本/实例隔离存档（PCL、HMCL 常见）
 *   3) <实例目录>/saves            —— 部分启动器的实例根目录
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const nbt = require('./nbt');

const MAX_ICON_BYTES = 256 * 1024;

/** 去掉 Minecraft 的 § 格式码（§6、§l、§x§f§f… 等） */
function stripFormatting(s) {
  if (!s) return s;
  return String(s)
    .replace(/§x(§[0-9a-fA-F]){6}/g, '')
    .replace(/§[0-9a-fk-orA-FK-OR]/g, '')
    .trim();
}

async function listDirs(p) {
  try {
    const ents = await fsp.readdir(p, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

/** 递归统计目录体积；await 会让出事件循环，避免阻塞主进程 */
async function dirSize(dir, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  let ents = [];
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        total += await dirSize(full, depth + 1);
      } else if (e.isFile()) {
        const st = await fsp.stat(full);
        total += st.size;
      }
    } catch {
      /* 文件被占用时忽略 */
    }
  }
  return total;
}

async function readIcon(saveDir) {
  const iconPath = path.join(saveDir, 'icon.png');
  try {
    const st = await fsp.stat(iconPath);
    if (!st.isFile() || st.size > MAX_ICON_BYTES) return null;
    const buf = await fsp.readFile(iconPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 读取单个存档目录
 * @param {string} saveDir 存档文件夹绝对路径
 * @param {object} ctx {dir, dirName, instanceId}
 */
async function readSave(saveDir, ctx) {
  const levelDat = path.join(saveDir, 'level.dat');
  let info = null;
  let broken = false;
  try {
    const buf = await fsp.readFile(levelDat);
    info = nbt.summarize(buf);
  } catch {
    broken = true;
  }

  let mtime = 0;
  try {
    mtime = (await fsp.stat(levelDat)).mtimeMs;
  } catch {
    try {
      mtime = (await fsp.stat(saveDir)).mtimeMs;
    } catch {}
  }

  const [icon, size] = await Promise.all([readIcon(saveDir), dirSize(saveDir)]);

  return {
    path: saveDir,
    folderName: path.basename(saveDir),
    name: stripFormatting((info && info.levelName) || path.basename(saveDir)) || path.basename(saveDir),
    version: (info && info.version) || '',
    gameType: (info && info.gameType) || '',
    difficulty: (info && info.difficulty) || '',
    hardcore: Boolean(info && info.hardcore),
    wasModded: Boolean(info && info.wasModded),
    lastPlayed: (info && info.lastPlayed) || mtime,
    size,
    icon,
    broken,
    dir: ctx.dir,
    dirName: ctx.dirName,
    instanceId: ctx.instanceId || null,
  };
}

/**
 * 扫描所有游戏目录下的存档
 * @param {Array<{path:string,name:string}>} dirs
 * @param {(done:number,total:number)=>void} onProgress
 */
async function scan(dirs, onProgress) {
  const jobs = [];

  for (const dir of dirs) {
    if (!dir.path || !fs.existsSync(dir.path)) continue;

    // 全局存档
    const globalSaves = path.join(dir.path, 'saves');
    for (const ent of await listDirs(globalSaves)) {
      jobs.push({ saveDir: path.join(globalSaves, ent.name), ctx: { dir: dir.path, dirName: dir.name } });
    }

    // 各实例的隔离存档
    const versionsDir = path.join(dir.path, 'versions');
    for (const inst of await listDirs(versionsDir)) {
      const instSaves = path.join(versionsDir, inst.name, 'saves');
      if (!fs.existsSync(instSaves)) continue;
      for (const ent of await listDirs(instSaves)) {
        jobs.push({
          saveDir: path.join(instSaves, ent.name),
          ctx: { dir: dir.path, dirName: dir.name, instanceId: inst.name },
        });
      }
    }
  }

  const results = [];
  let done = 0;
  const concurrency = 3;
  const queue = jobs.slice();

  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        results.push(await readSave(job.saveDir, job.ctx));
      } catch (e) {
        results.push({
          path: job.saveDir,
          folderName: path.basename(job.saveDir),
          name: path.basename(job.saveDir),
          broken: true,
          error: e.message,
          size: 0,
          lastPlayed: 0,
          icon: null,
          ...job.ctx,
        });
      }
      done += 1;
      if (onProgress) onProgress(done, jobs.length);
    }
  };

  await Promise.all(new Array(Math.min(concurrency, queue.length)).fill(0).map(worker));

  results.sort((a, b) => b.lastPlayed - a.lastPlayed);
  return results;
}

module.exports = { scan, dirSize };
