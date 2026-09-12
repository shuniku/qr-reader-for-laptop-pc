'use strict';
const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, shell, clipboard, dialog,
  nativeImage, systemPreferences, Menu,
} = require('electron');
const store = require('./store');

// 外部アプリへ渡すことを許可するスキーム。file: や javascript: は明示的に弾く。
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'smsto:', 'geo:', 'maps:']);
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'];

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: 'QR Reader',
    backgroundColor: '#11131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // アプリ内から外部サイトへ遷移／新規ウィンドウを開かせない
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel) => () => mainWindow?.webContents.send(channel);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'ファイル',
      submenu: [
        { label: '画像から読み取る…', accelerator: 'CmdOrCtrl+O', click: send('menu:open-image') },
        // 標準の「ペースト」(⌘V) を潰さないよう Shift を足す
        { label: 'クリップボードの画像から読み取る', accelerator: 'CmdOrCtrl+Shift+V', click: send('menu:paste-image') },
        { type: 'separator' },
        { label: 'スキャンの開始／停止', accelerator: 'CmdOrCtrl+R', click: send('menu:toggle-scan') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '表示',
      submenu: [
        { label: 'スキャン', accelerator: 'CmdOrCtrl+1', click: () => mainWindow?.webContents.send('menu:tab', 'scan') },
        { label: '履歴', accelerator: 'CmdOrCtrl+2', click: () => mainWindow?.webContents.send('menu:tab', 'history') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // macOS のカメラ許可ダイアログを起動時に出しておく（拒否されても起動は継続）
    try { await systemPreferences.askForMediaAccess('camera'); } catch { /* noop */ }
  }
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------ IPC ------------------------------ */

ipcMain.handle('history:load', () => store.load());
ipcMain.handle('history:add', (_e, entry) => store.add(entry ?? {}));
ipcMain.handle('history:remove', (_e, id) => store.remove(id));
ipcMain.handle('history:clear', () => store.clear());
ipcMain.handle('history:path', () => store.filePath());
ipcMain.handle('history:reveal', () => {
  const file = store.filePath();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else shell.openPath(path.dirname(file));
  return true;
});

ipcMain.handle('history:export', async (_e, format) => {
  const entries = store.load();
  if (entries.length === 0) return { ok: false, reason: 'empty' };

  const isCsv = format === 'csv';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '履歴をエクスポート',
    defaultPath: `qr-history-${stamp}.${isCsv ? 'csv' : 'json'}`,
    filters: isCsv
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };

  const body = isCsv ? store.toCsv(entries) : JSON.stringify(entries, null, 2);
  fs.writeFileSync(filePath, body, 'utf8');
  return { ok: true, path: filePath };
});

ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.handle('clipboard:image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return image.toDataURL();
});

ipcMain.handle('url:open', async (_e, rawUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: 'scheme', scheme: parsed.protocol };
  }
  await shell.openExternal(parsed.href);
  return { ok: true };
});

ipcMain.handle('image:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'QRコード画像を選択',
    properties: ['openFile'],
    filters: [{ name: '画像', extensions: IMAGE_EXTENSIONS }],
  });
  if (canceled || filePaths.length === 0) return null;
  return readImageAsDataUrl(filePaths[0]);
});

ipcMain.handle('image:read', (_e, filePath) => readImageAsDataUrl(String(filePath)));

function readImageAsDataUrl(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;
  // nativeImage 経由にすることで、壊れた／画像でないファイルをここで弾ける
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  return { name: path.basename(filePath), dataUrl: image.toDataURL() };
}

ipcMain.handle('text:save', async (_e, payload) => {
  const { text, defaultName, extension } = payload ?? {};
  const ext = String(extension || 'txt');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '内容を保存',
    defaultPath: String(defaultName || `qr-content.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };
  fs.writeFileSync(filePath, String(text ?? ''), 'utf8');
  return { ok: true, path: filePath };
});
