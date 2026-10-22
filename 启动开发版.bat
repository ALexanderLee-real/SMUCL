@echo off
chcp 65001 >nul
title SMUCL 开发模式
cd /d "%~dp0"

rem 某些终端环境会残留 ELECTRON_RUN_AS_NODE，导致 Electron 以纯 Node 模式启动
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=

if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] 未找到 Electron 运行时，请先执行：
  echo     npm install
  echo     或设置镜像后重装：
  echo     set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  echo     node node_modules\electron\install.js
  pause
  exit /b 1
)

echo 正在启动 SMUCL（开发模式）...
call npx electron .
if errorlevel 1 pause
