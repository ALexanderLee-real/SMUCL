'use strict';
/**
 * 在桌面创建 SMUCL 快捷方式：electron build/make-shortcut.js
 * 该环境禁用了 WScript.Shell COM，改用 Electron 的 shell.writeShortcutLink。
 */
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const desktop = app.getPath('desktop');
  const appDir = process.env.SMUCL_APP_DIR || path.join(desktop, 'SMUCL');
  const exe = path.join(appDir, 'SMUCL.exe');
  const lnkName = process.env.SMUCL_LNK_NAME || 'SMUCL.lnk';
  const lnk = path.join(desktop, lnkName);

  if (!fs.existsSync(exe)) {
    console.error('未找到可执行文件：', exe);
    app.exit(1);
    return;
  }

  const ok = shell.writeShortcutLink(lnk, 'create', {
    target: exe,
    cwd: appDir,
    icon: exe,
    iconIndex: 0,
    description: 'SMUCL 上海海事大学 Minecraft 启动器',
    appUserModelId: 'cn.edu.shmtu.smucl',
  });

  console.log(`快捷方式${ok ? '已创建' : '创建失败'}：${lnk}`);
  console.log('目标：', exe);
  app.exit(ok ? 0 : 1);
});
