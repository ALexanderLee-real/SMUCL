'use strict';
// Windows 图形设置里的「按应用设置显卡偏好」实际写在 HKCU 下的这张表：
//   值名 = exe 绝对路径，值 = "GpuPreference=2;"（2 高性能 / 1 省电）
// 没有这个值等于「让 Windows 决定」，删除值即可恢复默认。
const path = require('path');
const { execFile } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const MODES = { high: 'GpuPreference=2;', power: 'GpuPreference=1;', auto: null };

function supported() {
  return process.platform === 'win32';
}

function normalizeExe(p) {
  const raw = String(p || '').trim().replace(/^"+|"+$/g, '');
  if (!raw) return '';
  return path.resolve(raw).replace(/\//g, '\\');
}

// 游戏是 javaw.exe 拉起的，注册表值名必须是 javaw 的路径，写 java.exe 不生效
function toJavaw(p) {
  const exe = normalizeExe(p);
  return /\\java\.exe$/i.test(exe) ? exe.replace(/\\java\.exe$/i, '\\javaw.exe') : exe;
}

function run(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: decode(stdout), stderr: decode(stderr).trim() });
    });
  });
}

// reg.exe 的输出是系统 ANSI 代码页（中文 Windows 为 GBK），直接按 UTF-8 读会乱码
function decode(buf) {
  if (!buf || !buf.length) return '';
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return Buffer.from(buf).toString('utf8');
  }
}

/** 读取当前已设置的显卡偏好：key 为小写 exe 路径，value 为原始数据 */
async function readAll() {
  if (!supported()) return new Map();
  const r = await run(['query', REG_KEY]);
  const map = new Map();
  if (!r.ok) return map;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/);
    if (m) map.set(m[1].toLowerCase(), m[3]);
  }
  return map;
}

async function setPreference(exePath, mode) {
  if (!supported()) return { ok: false, error: '仅 Windows 支持显卡偏好设置' };
  if (!(mode in MODES)) return { ok: false, error: `未知的显卡模式：${mode}` };
  const exe = toJavaw(exePath);
  if (!exe) return { ok: false, error: 'Java 路径为空' };

  if (MODES[mode] === null) {
    // 先查再删：reg delete 找不到值时返回非零，但这里应当视为「已经是默认」
    const current = await readAll();
    if (!current.has(exe.toLowerCase())) return { ok: true, exe };
    const r = await run(['delete', REG_KEY, '/v', exe, '/f']);
    return { ok: r.ok, exe, error: r.ok ? undefined : r.stderr || '注册表删除失败' };
  }

  const r = await run(['add', REG_KEY, '/v', exe, '/t', 'REG_SZ', '/d', MODES[mode], '/f']);
  return { ok: r.ok, exe, error: r.ok ? undefined : r.stderr.trim() || '注册表写入失败' };
}

/** 批量写入，按 javaw 路径去重，逐个返回结果 */
async function applyAll(exePaths, mode) {
  if (!supported()) return { supported: false, mode, applied: [], failed: [] };
  const unique = Array.from(new Set((exePaths || []).filter(Boolean).map(toJavaw)));
  const applied = [];
  const failed = [];
  for (const exe of unique) {
    const r = await setPreference(exe, mode);
    if (r.ok) applied.push({ exe });
    else failed.push({ exe, error: r.error });
  }
  return { supported: true, mode, applied, failed };
}

module.exports = { REG_KEY, MODES, supported, normalizeExe, toJavaw, readAll, setPreference, applyAll };
