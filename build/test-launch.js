'use strict';
/**
 * 实例启动冒烟测试：electron build/test-launch.js
 * 环境变量：
 *   SMUCL_TEST_ID   实例名（默认取检测到的第一个）
 *   SMUCL_TEST_SEC  运行秒数（默认 30）
 */
const { app } = require('electron');
const path = require('path');

app.setPath('userData', path.join(__dirname, 'test-userdata'));

app.whenReady().then(async () => {
  const settings = require('../core/settings');
  const javaLib = require('../core/java');
  const versionLib = require('../core/version');
  const dirsLib = require('../core/dirs');
  const launcher = require('../core/launch');

  settings.init();
  const settingsAll = settings.all();
  const dirs = dirsLib.all(settingsAll);
  console.log('游戏目录:', dirs.map((d) => `${d.name}=${d.path}`).join(' | '));

  const installed = versionLib.listInstalled(dirs);
  console.log(`检测到 ${installed.length} 个实例`);
  const id = process.env.SMUCL_TEST_ID || (installed[0] && installed[0].id);
  const inst = installed.find((v) => v.id === id);
  if (!inst) {
    console.log('未找到实例', id);
    app.exit(1);
    return;
  }

  const built = launcher.build(inst.id, { ...settingsAll, sourceDir: inst.dir });
  console.log('实例:', inst.id, '| 隔离:', inst.isolated, '| 模组:', inst.mods);
  console.log('工作目录(cwd):', built.cwd);
  const gi = built.args.indexOf('--gameDir');
  console.log('参数中的 --gameDir:', gi >= 0 ? built.args[gi + 1] : '(旧版参数，使用 ${game_directory})');
  console.log('natives:', (built.args.find((a) => a.startsWith('-Djava.library.path=')) || '(无)').slice(21));

  const javas = await javaLib.detect({ mcDir: inst.dir, preferred: settingsAll.javaPath });
  const required = (built.meta.javaVersion && built.meta.javaVersion.majorVersion) || 8;
  const picked = javaLib.pick(javas, required);
  console.log(`需要 Java ${required}，选用 ${picked && picked.major} ${picked && picked.path}`);

  const lines = [];
  const started = Date.now();
  const proc = launcher.launch(
    inst.id,
    { ...settingsAll, sourceDir: inst.dir, javaPath: picked.path },
    {
      onLog: (l) => {
        lines.push(l);
        if (lines.length <= 25) console.log('  |', l.slice(0, 150));
      },
      onError: (e) => console.log('  进程错误:', e.message),
      onExit: (code) => console.log('  进程退出，代码', code, `（${Math.round((Date.now() - started) / 1000)}s）`),
    }
  );
  console.log('已启动 PID =', proc.pid);

  const seconds = Number(process.env.SMUCL_TEST_SEC || 30);
  setTimeout(() => {
    try {
      proc.child.kill();
      console.log('已结束进程');
    } catch {}
    console.log(`累计日志 ${lines.length} 行`);
    setTimeout(() => app.exit(0), 1000);
  }, seconds * 1000);
});
