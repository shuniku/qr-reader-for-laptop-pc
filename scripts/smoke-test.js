// Electron 上でアプリを起動し、画像デコード・種別判定・IPC を通しで検証する。
// 実行: npm test  （GUI セッションが必要。カメラ権限は使わない）
const fs = require('fs');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { app, BrowserWindow, session, systemPreferences, clipboard } = require('electron');

// テスト実行中に本物の履歴を壊さない／カメラ許可ダイアログを出さない
const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-reader-test-'));
app.setPath('userData', sandboxDir);
systemPreferences.askForMediaAccess = async () => false;

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 読み取りにくいケースも含めたテスト画像
const FIXTURES = [
  { name: '通常のURL', text: 'https://example.com/hello?q=1', type: 'url', options: { width: 400, margin: 2 } },
  { name: 'スキームなしURL', text: 'example.co.jp/path', type: 'url', options: { width: 400, margin: 2 } },
  { name: '日本語テキスト', text: 'こんにちは、QRコードのテストです。', type: 'text', options: { width: 400, margin: 2 } },
  { name: 'Wi-Fi設定', text: 'WIFI:T:WPA;S:MyNet;P:pa$$w:ord;H:true;;', type: 'wifi', options: { width: 200, margin: 2 } },
  { name: 'vCard', text: 'BEGIN:VCARD\nVERSION:3.0\nFN:山田 太郎\nTEL;CELL:090-1234-5678\nEND:VCARD', type: 'contact', options: { width: 400, margin: 2 } },
  { name: '小さい画像', text: 'https://example.com/hello?q=1', type: 'url', options: { width: 120, margin: 1 } },
  { name: '白黒反転', text: 'https://example.com/hello?q=1', type: 'url', options: { width: 400, margin: 2, color: { dark: '#FFFFFFFF', light: '#000000FF' } } },
  { name: '背景が透過', text: 'https://example.com/hello?q=1', type: 'url', options: { width: 400, margin: 2, color: { light: '#00000000' } } },
];

require(path.join(ROOT, 'src', 'main', 'main.js'));

const consoleErrors = [];
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) consoleErrors.push(event.message);
  });
});

app.whenReady().then(async () => {
  // ブラウザ側の権限要求はすべて拒否し、カメラ非許可時の挙動を確認する
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  await wait(2500);

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    check('ウィンドウの生成', false);
    return finish();
  }

  console.log('\n[1] 画像からの読み取り');
  const payload = await Promise.all(FIXTURES.map(async (fixture) => ({
    name: fixture.name,
    expected: fixture.type,
    dataUrl: await QRCode.toDataURL(fixture.text, fixture.options),
  })));

  const decoded = await win.webContents.executeJavaScript(`(async () => {
    const { decodeImageFile } = await import('./scanner.js');
    const { parseContent } = await import('./parse.js');
    const results = [];
    for (const item of ${JSON.stringify(payload)}) {
      const found = await decodeImageFile(item.dataUrl);
      results.push({
        name: item.name,
        expected: item.expected,
        ok: Boolean(found),
        type: found ? parseContent(found.text).type : null,
      });
    }
    return { results, hasJsQR: typeof window.jsQR === 'function' };
  })()`);

  check('jsQR の読み込み', decoded.hasJsQR);
  for (const result of decoded.results) {
    check(result.name, result.ok && result.type === result.expected, `種別=${result.type ?? '検出なし'}`);
  }

  console.log('\n[2] 履歴とクリップボード');
  const probe = await win.webContents.executeJavaScript(`(async () => {
    const before = (await window.qr.history.load()).length;
    await window.qr.history.add({ text: 'https://example.com/probe', type: 'url', source: 'image' });
    const after = (await window.qr.history.load()).length;
    await window.qr.clipboard.write('clipboard-probe');
    const cleared = await window.qr.history.clear();
    return { grew: after === before + 1, clearedTo: cleared.length };
  })()`);
  check('履歴の追加', probe.grew);
  check('履歴の全削除', probe.clearedTo === 0);
  check('クリップボードへの書き込み', (await clipboard.readText()) === 'clipboard-probe');

  console.log('\n[3] 外部リンクの制限');
  const blocked = await win.webContents.executeJavaScript(`(async () => ({
    file: await window.qr.openUrl('file:///etc/passwd'),
    js: await window.qr.openUrl('javascript:alert(1)'),
    broken: await window.qr.openUrl('これはURLではありません'),
  }))()`);
  check('file: を拒否', blocked.file.ok === false);
  check('javascript: を拒否', blocked.js.ok === false);
  check('不正な文字列を拒否', blocked.broken.ok === false);

  console.log('\n[4] カメラを使えない場合の表示');
  const ui = await win.webContents.executeJavaScript(`({
    stageTitle: document.getElementById('stage-title').textContent,
    retryVisible: !document.getElementById('stage-action').hidden,
    cameraOptions: document.getElementById('camera-select').length,
    overflowsHorizontally: document.body.scrollWidth > window.innerWidth,
    permissionNote: document.getElementById('stage-note').textContent,
    shortcutKeys: [...document.querySelectorAll('#hint-paste kbd')].map((k) => k.textContent),
    macClass: document.body.classList.contains('is-mac'),
  })`);
  // CI のようにカメラ自体が無い環境では「見つかりません」側の案内になる
  const deniedState = ui.stageTitle.includes('許可されていません');
  const missingState = ui.stageTitle.includes('見つかりません');
  check('カメラを使えない理由を表示', deniedState || missingState, ui.stageTitle);
  check('再試行ボタンを表示', ui.retryVisible);
  check('カメラ一覧が空にならない', ui.cameraOptions > 0);
  check('横スクロールが出ない', !ui.overflowsHorizontally);

  console.log('\n[5] OS ごとの表示の切り替え');
  const isMac = process.platform === 'darwin';
  const expectedKeys = isMac ? ['⇧', '⌘', 'V'] : ['Ctrl', 'Shift', 'V'];
  check('ショートカット表記', ui.shortcutKeys.join('+') === expectedKeys.join('+'), ui.shortcutKeys.join('+'));
  check('macOS 用の余白クラス', ui.macClass === isMac);
  const expectedNote = isMac ? 'システム設定' : (process.platform === 'win32' ? '設定 →' : 'OS のカメラ設定');
  if (deniedState) {
    check('カメラ許可の案内が OS に合っている', ui.permissionNote.includes(expectedNote), ui.permissionNote.slice(0, 40));
  } else {
    console.log('  skip カメラ許可の案内 — カメラが無い環境のため');
  }

  check('renderer にエラーログなし', consoleErrors.length === 0, consoleErrors.join(' / '));
  finish();
}).catch((error) => {
  console.error(error);
  failures.push(String(error));
  finish();
});

function finish() {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  console.log(failures.length === 0 ? '\n✅ すべて成功' : `\n❌ ${failures.length} 件失敗: ${failures.join(', ')}`);
  app.exit(failures.length === 0 ? 0 : 1);
}
