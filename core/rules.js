'use strict';
/**
 * 版本 JSON 的规则引擎：按操作系统 / 特性决定某条库或参数是否生效。
 */

const ARCH_MAP = { x64: 'x64', ia32: 'x86', arm64: 'arm64' };

function matchOs(os) {
  if (!os) return true;
  if (os.name && os.name !== process.platform) return false;
  if (os.arch) {
    const cur = ARCH_MAP[process.arch] || process.arch;
    if (os.arch !== cur) return false;
  }
  if (os.version) {
    try {
      if (!new RegExp(os.version).test(require('os').release())) return false;
    } catch {
      /* 正则无效时视为通过 */
    }
  }
  return true;
}

/**
 * @param {Array} rules  version.arguments.* 里的 rules
 * @param {Object} features  当前特性开关，如 { has_custom_resolution: true }
 */
function allowed(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let result = false;
  for (const rule of rules) {
    if (!matchOs(rule.os)) continue;
    if (rule.features) {
      let ok = true;
      for (const [key, val] of Object.entries(rule.features)) {
        if (Boolean(features[key]) !== Boolean(val)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    result = rule.action === 'allow';
  }
  return result;
}

/** 展开 arguments 数组里的字符串与 {rules, value} 条件项 */
function flatten(args, features = {}) {
  const out = [];
  for (const arg of args || []) {
    if (typeof arg === 'string') {
      out.push(arg);
    } else if (arg && Array.isArray(arg.value)) {
      if (allowed(arg.rules, features)) out.push(...arg.value);
    } else if (arg && typeof arg.value === 'string') {
      if (allowed(arg.rules, features)) out.push(arg.value);
    }
  }
  return out;
}

module.exports = { allowed, flatten, matchOs };
