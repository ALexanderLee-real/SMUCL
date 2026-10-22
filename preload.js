'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('smucl', {
  // 只读数据
  state: () => ipcRenderer.invoke('app:state'),
  manifest: (opts) => ipcRenderer.invoke('versions:manifest', opts || {}),
  installed: () => ipcRenderer.invoke('versions:installed'),
  detectJava: () => ipcRenderer.invoke('java:detect'),
  command: (id, dir) => ipcRenderer.invoke('version:command', { id, dir }),
  sizes: () => ipcRenderer.invoke('versions:sizes'),

  // 游戏目录
  dirs: () => ipcRenderer.invoke('dirs:list'),
  addDir: () => ipcRenderer.invoke('dirs:add'),
  removeDir: (path) => ipcRenderer.invoke('dirs:remove', { path }),
  setPrimaryDir: (path) => ipcRenderer.invoke('dirs:setPrimary', { path }),

  // 存档
  saves: () => ipcRenderer.invoke('saves:list'),
  revealSave: (path) => ipcRenderer.invoke('saves:reveal', { path }),
  trashSave: (path) => ipcRenderer.invoke('saves:trash', { path }),

  // 动作
  install: (id, url) => ipcRenderer.invoke('install:start', { id, url }),
  remove: (id, dir) => ipcRenderer.invoke('version:delete', { id, dir }),
  launch: (id, dir) => ipcRenderer.invoke('game:launch', { id, dir }),
  kill: () => ipcRenderer.invoke('game:kill'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  pickJava: () => ipcRenderer.invoke('dialog:pickJava'),
  openPath: (target) => ipcRenderer.invoke('open:path', { target }),
  openUrl: (url) => ipcRenderer.invoke('open:url', { url }),

  // 显卡偏好（Windows 图形设置）
  applyGpuAll: (mode) => ipcRenderer.invoke('gpu:applyAll', { mode }),

  // 应用自身更新
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: (opts) => ipcRenderer.invoke('update:check', opts || {}),
  installUpdate: (asset) => ipcRenderer.invoke('update:install', { asset }),

  // 窗口
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },

  // 事件
  onInstall: (cb) => on('install:progress', cb),
  onLog: (cb) => on('game:log', cb),
  onExit: (cb) => on('game:exit', cb),
  onError: (cb) => on('game:error', cb),
  onLatest: (cb) => on('manifest:latest', cb),
  onSavesProgress: (cb) => on('saves:progress', cb),
  onVersionSize: (cb) => on('versions:size', cb),
  onUpdateAvailable: (cb) => on('update:available', cb),
  onUpdateFailed: (cb) => on('update:failed', cb),
  onUpdateProgress: (cb) => on('update:progress', cb),
});
