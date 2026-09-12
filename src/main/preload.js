'use strict';
// renderer に公開する API。ここに列挙したもの以外は renderer から触れない。
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('qr', {
  platform: process.platform,
  history: {
    load: () => ipcRenderer.invoke('history:load'),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    clear: () => ipcRenderer.invoke('history:clear'),
    path: () => ipcRenderer.invoke('history:path'),
    reveal: () => ipcRenderer.invoke('history:reveal'),
    export: (format) => ipcRenderer.invoke('history:export', format),
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    image: () => ipcRenderer.invoke('clipboard:image'),
  },
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  readImage: (filePath) => ipcRenderer.invoke('image:read', filePath),
  saveText: (payload) => ipcRenderer.invoke('text:save', payload),
  // ドロップされた File から実パスを得る（Electron 32 以降は file.path が使えない）
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  onMenu: (handler) => {
    const bind = (channel, arg) =>
      ipcRenderer.on(channel, (_e, payload) => handler(arg ?? channel, payload));
    bind('menu:open-image');
    bind('menu:paste-image');
    bind('menu:toggle-scan');
    bind('menu:tab');
  },
});
