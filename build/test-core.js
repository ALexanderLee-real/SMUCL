'use strict';
/**
 * 核心链路自测（开发用）：
 *   electron build/test-core.js
 * 1) 真实安装一个轻量版本（1.5.2）到隔离目录
 * 2) 校验文件结构、natives、旧版虚拟资源
 * 3) 构建启动命令，检查占位符是否全部替换
 * 4) 用现代版本（1.21.4）的 JSON 验证新参数格式
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST_ROOT = path.join(__dirname, 'test-mc');
const USERDATA = path.join(__dirname, 'test-userdata');

app.setPath('userData', USERDATA);

function log(...a) {
  console.log(...a);
}

function countFiles(dir, ext) {
  let n = 0;
  const walk = (p) => {
    let ents = [];
    try {
      ents = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (!ext || full.endsWith(ext)) n++;
    }
  };
  walk(dir);
  return n;
}

app.whenReady().then(async () => {
  const settings = require('../core/settings');
  const versionLib = require('../core/version');
  const installer = require('../core/install');
  const launcher = require('../core/launch');

  settings.init();
  settings.save({ mcDir: TEST_ROOT, downloadSource: 'mojang', memory: 2048, playerName: 'Steve' });
  settings.ensureGameDir();

  let failed = 0;
  const check = (name, cond, extra = '') => {
    log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) failed++;
  };

  try {
    // ---------------- 1. 安装 1.5.2 ----------------
    const manifest = await versionLib.getManifest('mojang', { force: true });
    const entry = manifest.versions.find((v) => v.id === '1.5.2');
    check('版本清单包含 1.5.2', Boolean(entry));

    let last = 0;
    const result = await installer.install('1.5.2', entry, 'mojang', (p) => {
      if (p.percent !== undefined && p.percent - last >= 20) {
        last = p.percent;
        log(`   安装进度 ${p.percent}% ${p.message || ''}`);
      }
    });
    log('   安装结果:', JSON.stringify({ files: result.files, bytes: result.bytes, s: result.seconds }));

    const vdir = path.join(TEST_ROOT, 'versions', '1.5.2');
    check('版本 JSON 已写入', fs.existsSync(path.join(vdir, '1.5.2.json')));
    check('client.jar 已下载', fs.existsSync(path.join(vdir, '1.5.2.jar')));
    const libs = countFiles(path.join(TEST_ROOT, 'libraries'), '.jar');
    check('依赖库已就位', libs >= 8, `${libs} 个 jar（13 条库含重复项与纯 natives 项）`);
    const natives = countFiles(path.join(vdir, 'natives'));
    check('natives 已解压', natives >= 1, `${natives} 个文件`);
    const objects = countFiles(path.join(TEST_ROOT, 'assets', 'objects'));
    check('资源对象 >= 100 个', objects >= 100, `${objects} 个`);
    const legacyAssets = countFiles(path.join(TEST_ROOT, 'resources'));
    check('pre-1.6 资源已映射到 resources', legacyAssets >= 100, `${legacyAssets} 个`);

    // ---------------- 2. 旧版启动命令 ----------------
    const built = launcher.build('1.5.2', settings.all());
    const cmd = built.args.join(' ');
    log('   启动命令片段:', built.args.slice(0, 6).join(' '), '...', built.args.slice(-8).join(' '));
    check('主类来自版本 JSON', built.args.includes(built.meta.mainClass), built.meta.mainClass);
    check('无未替换占位符', !/\$\{[a-zA-Z_]+\}/.test(cmd), (cmd.match(/\$\{[a-zA-Z_]+\}/g) || []).join(','));
    check('包含玩家名', cmd.includes('Steve'));
    check('包含 --gameDir', cmd.includes('--gameDir'));
    check('内存参数正确', built.args.includes('-Xmx2048M'), built.args.find((a) => a.startsWith('-Xmx')));
    const uuid = launcher.offlineUuid('Steve');
    log('   离线 UUID(Steve) =', uuid);
    check('离线 UUID 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid), uuid);

    // ---------------- 3. 现代版本参数 ----------------
    const modern = manifest.versions.find((v) => v.id === '1.21.4');
    if (modern) {
      const meta = await versionLib.getVersionMeta(modern, 'mojang');
      const dir = path.join(TEST_ROOT, 'versions', '1.21.4');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '1.21.4.json'), JSON.stringify(meta, null, 2));
      fs.writeFileSync(path.join(dir, '1.21.4.jar'), ''); // 占位，仅用于 classpath 拼接

      const b2 = launcher.build('1.21.4', settings.all());
      const cmd2 = b2.args.join(' ');
      check('现代版本主类存在', Boolean(b2.args.find((a) => a.includes('net.minecraft.client.main.Main'))));
      check('现代版本无未替换占位符', !/\$\{[a-zA-Z_]+\}/.test(cmd2), (cmd2.match(/\$\{[a-zA-Z_]+\}/g) || []).join(','));
      check('现代版本带 --version', cmd2.includes('--version 1.21.4'));
      check('现代版本带 --assetIndex', cmd2.includes('--assetIndex'));
      check('现代版本带 --xuid', cmd2.includes('--xuid'));
      log('   现代版本参数条数:', b2.args.length);
    }

    log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
    log(`测试目录：${TEST_ROOT}`);
  } catch (e) {
    console.error('测试异常:', e);
    failed++;
  }
  app.exit(failed === 0 ? 0 : 1);
});
