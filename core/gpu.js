'use strict';
/**
 * Windows 显卡偏好
 *
 * Windows 的「按应用设置图形性能」并不写在注册表的 GraphicsDrivers 下，
 * 而是存于当前用户：
 *   HKCU\Software\Microsoft\DirectX\UserGpuPreferences
 * 值名 = exe 的绝对路径，值 = "GpuPreference=2;"（2 高性能 / 1 省电）
 * 没有这个值 = 交给 Windows 自动选择，删掉值即可恢复。
 *
 * 注意：Minecraft 由 javaw.exe 启动，值名必须写 javaw 的路径，写 java.exe 不生效。
 */
const path = require('path');
const { execFile } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const MODES = { high: 'GpuPreference=2;', power: 'GpuPreference=1;', auto: null };

function supported() {
  return process.platform === 'win32';
}

/** 统一成 Windows 绝对路径，去掉误粘贴的引号 */
function normalizeExe(p) {
  const raw = String(p || '').trim().replace(/^"+|"+$/g, '');
  if (!raw) return '';
  return path.resolve(raw).replace(/\//g, '\\');
}

/** java.exe → javaw.exe */
function toJavaw(p) {
  const exe = normalizeExe(p);
  return /\\java\.exe$/i.test(exe) ? exe.replace(/\\java\.exe$/i, '\\javaw.exe') : exe;
}

function decode(buf) {
  if (!buf || !buf.length) return '';
  try {
    // reg.exe 输出走系统 ANSI 代码页，中文 Windows 是 GBK
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return Buffer.from(buf).toString('utf8');
  }
}

/** 把 spawn 的原始错误翻成人话 */
function friendly(err) {
  const sig = `${(err && err.code) || ''} ${(err && err.message) || ''}`;
  if (/EACCES|EPERM/.test(sig)) return '被安全软件或系统策略拦截，无法调用 reg.exe';
  if (/ENOENT/.test(sig)) return '系统里找不到 reg.exe';
  return (err && err.message) || '调用 reg.exe 失败';
}

function run(args) {
  return new Promise((resolve) => {
    const done = (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, stdout: decode(stdout), stderr: '' });
      resolve({ ok: false, stdout: '', stderr: decode(stderr).trim() || friendly(err) });
    };
    try {
      execFile('reg.exe', args, { windowsHide: true, encoding: 'buffer' }, done);
    } catch (e) {
      // 极端情况下 execFile 会同步抛（安全软件拦截 CreateProcess）
      resolve({ ok: false, stdout: '', stderr: friendly(e) });
    }
  });
}

/** 读出已有配置：key 为小写 exe 路径，value 为原始数据 */
async function readAll() {
  if (!supported()) return new Map();
  const r = await run(['query', REG_KEY]);
  const map = new Map();
  if (!r.ok) return map;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/);
    if (m) map.set(m[1].toLowerCase(), m[3].trim());
  }
  return map;
}

async function setPreference(exePath, mode) {
  if (!supported()) return { ok: false, error: '仅 Windows 支持显卡偏好' };
  if (!(mode in MODES)) return { ok: false, error: `未知的显卡模式：${mode}` };

  const exe = toJavaw(exePath);
  if (!exe) return { ok: false, error: 'Java 路径为空' };

  // 恢复自动：值本来就不存在，直接算成功，避免 reg delete 报错被当成失败
  if (MODES[mode] === null) {
    const current = await readAll();
    if (!current.has(exe.toLowerCase())) return { ok: true, exe, skipped: true };
    const r = await run(['delete', REG_KEY, '/v', exe, '/f']);
    return { ok: r.ok, exe, error: r.ok ? undefined : r.stderr || '注册表删除失败' };
  }

  const r = await run(['add', REG_KEY, '/v', exe, '/t', 'REG_SZ', '/d', MODES[mode], '/f']);
  return { ok: r.ok, exe, error: r.ok ? undefined : r.stderr || '注册表写入失败' };
}

/** 批量写入，按 javaw 路径去重，逐个返回结果 */
async function applyAll(exePaths, mode) {
  if (!supported()) return { supported: false, mode, applied: [], failed: [] };
  const unique = Array.from(new Set((exePaths || []).filter(Boolean).map(toJavaw)));
  const applied = [];
  const failed = [];
  for (const exe of unique) {
    try {
      const r = await setPreference(exe, mode);
      if (r.ok) applied.push({ exe });
      else failed.push({ exe, error: r.error });
    } catch (e) {
      failed.push({ exe, error: friendly(e) });
    }
  }
  return { supported: true, mode, applied, failed };
}

module.exports = { REG_KEY, MODES, supported, friendly, normalizeExe, toJavaw, readAll, setPreference, applyAll };
