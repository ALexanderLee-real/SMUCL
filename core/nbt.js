'use strict';
/**
 * 极简 NBT 读取器（仅解析，不写回）。
 * 只用于读存档 level.dat：世界名、版本、最后游玩时间、游戏模式等。
 */
const zlib = require('zlib');

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  need(n) {
    if (this.pos + n > this.buf.length) throw new Error('NBT 数据越界');
  }
  u1() {
    this.need(1);
    return this.buf.readUInt8(this.pos++);
  }
  i1() {
    this.need(1);
    return this.buf.readInt8(this.pos++);
  }
  i2() {
    this.need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u2() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i4() {
    this.need(4);
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i8() {
    this.need(8);
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return Number(v);
  }
  f4() {
    this.need(4);
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  f8() {
    this.need(8);
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
  str() {
    const len = this.u2();
    this.need(len);
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
}

function readPayload(r, type) {
  switch (type) {
    case 1: return r.i1();
    case 2: return r.i2();
    case 3: return r.i4();
    case 4: return r.i8();
    case 5: return r.f4();
    case 6: return r.f8();
    case 7: {
      const n = r.i4();
      r.need(n);
      r.pos += n;
      return { __bytes: n };
    }
    case 8: return r.str();
    case 9: {
      const itemType = r.u1();
      const n = r.i4();
      const arr = [];
      const cap = Math.min(n, 512); // 大列表不展开，避免读档卡顿
      for (let i = 0; i < n; i++) {
        const v = readPayload(r, itemType);
        if (i < cap) arr.push(v);
      }
      return arr;
    }
    case 10: {
      const obj = {};
      for (;;) {
        const t = r.u1();
        if (t === 0) break;
        const name = r.str();
        obj[name] = readPayload(r, t);
      }
      return obj;
    }
    case 11: {
      const n = r.i4();
      r.need(n * 4);
      r.pos += n * 4;
      return { __ints: n };
    }
    case 12: {
      const n = r.i4();
      r.need(n * 8);
      r.pos += n * 8;
      return { __longs: n };
    }
    default:
      throw new Error(`未知的 NBT 类型 ${type}`);
  }
}

/** 解析 level.dat（gzip 压缩的 NBT），返回根复合标签的对象 */
function readLevelDat(fileBuffer) {
  let buf = fileBuffer;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const r = new Reader(buf);
  const type = r.u1();
  if (type !== 10) throw new Error('level.dat 根标签不是 Compound');
  r.str(); // 根标签名，通常为空
  return readPayload(r, 10);
}

const GAME_MODE = { 0: '生存', 1: '创造', 2: '冒险', 3: '旁观' };
const DIFFICULTY_NUM = { 0: '和平', 1: '简单', 2: '普通', 3: '困难' };
const DIFFICULTY_STR = {
  peaceful: '和平',
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

/** 从 level.dat 提炼 UI 需要的字段 */
function summarize(buf) {
  const root = readLevelDat(buf);
  const d = root.Data || root;
  const version = d.Version && d.Version.Name ? String(d.Version.Name) : '';
  const ds = d.difficulty_settings || d.DifficultySettings || {};
  const difficulty =
    DIFFICULTY_STR[ds.difficulty] || DIFFICULTY_NUM[Number(d.Difficulty)] || '未知';
  const seedRaw =
    d.WorldGenSettings?.seed ?? d.world_gen_settings?.seed ?? d.RandomSeed ?? null;

  return {
    levelName: d.LevelName || '',
    version,
    snapshot: (d.Version && d.Version.Snapshot) || false,
    lastPlayed: Number(d.LastPlayed) || 0,
    gameType: GAME_MODE[Number(d.GameType)] || '未知',
    difficulty,
    hardcore: Boolean(Number(ds.hardcore ?? d.hardcore ?? 0)),
    seed: seedRaw === null ? null : Number(seedRaw),
    dataVersion: Number(d.DataVersion) || 0,
    allowCommands: Boolean(Number(d.allowCommands || 0)),
    wasModded: Boolean(Number(d.WasModded || 0)),
  };
}

module.exports = { readLevelDat, summarize };
