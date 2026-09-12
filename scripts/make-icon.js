// アプリアイコン（build/icon.icns）を生成する。実行: npm run icon
// Electron の canvas で 1024px の PNG を描き、sips / iconutil で icns にまとめる。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const QRCode = require('qrcode');
const { app, BrowserWindow } = require('electron');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const PNG_PATH = path.join(BUILD_DIR, 'icon.png');
const ICONSET_DIR = path.join(BUILD_DIR, 'icon.iconset');
const ICNS_PATH = path.join(BUILD_DIR, 'icon.icns');
const ICO_PATH = path.join(BUILD_DIR, 'icon.ico');

// Windows の .ico に入れる解像度
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * PNG を埋め込む形式の .ico を組み立てる（Windows Vista 以降が対応）。
 * 構成: ICONDIR(6) + ICONDIRENTRY(16 x 枚数) + 各PNGの中身
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // 256px は 0 で表す
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);              // パレット数（PNG なので 0）
    entry.writeUInt8(0, 3);              // reserved
    entry.writeUInt16LE(1, 4);           // color planes
    entry.writeUInt16LE(32, 6);          // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

// macOS のアイコンは 1024px キャンバスに 824px の角丸正方形を置くのが標準的な比率
const SIZE = 1024;
const INSET = 100;
const BOX = SIZE - INSET * 2;
const RADIUS = Math.round(BOX * 0.2237);

app.whenReady().then(async () => {
  const qrDataUrl = await QRCode.toDataURL('https://github.com/shuniku/qr-reader-for-laptop-pc', {
    margin: 0,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: '#FFFFFFFF', light: '#00000000' },
  });

  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE });
  await win.loadURL('about:blank');

  const pngDataUrl = await win.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = ${SIZE};
    canvas.height = ${SIZE};
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(${INSET}, ${INSET}, ${INSET + BOX}, ${INSET + BOX});
    gradient.addColorStop(0, '#5b8cff');
    gradient.addColorStop(1, '#3452c8');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(${INSET}, ${INSET}, ${BOX}, ${BOX}, ${RADIUS});
    ctx.fill();

    const qr = new Image();
    await new Promise((resolve, reject) => {
      qr.onload = resolve;
      qr.onerror = reject;
      qr.src = ${JSON.stringify(qrDataUrl)};
    });
    const qrSize = Math.round(${BOX} * 0.62);
    const qrPos = Math.round((${SIZE} - qrSize) / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, qrPos, qrPos, qrSize, qrSize);

    // 読み取り枠を思わせるコーナーブラケット
    const margin = Math.round(${BOX} * 0.11);
    const left = ${INSET} + margin;
    const right = ${INSET} + ${BOX} - margin;
    const arm = Math.round(${BOX} * 0.11);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.round(${BOX} * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [x, y, dx, dy] of [[left, left, 1, 1], [right, left, -1, 1], [left, right, 1, -1], [right, right, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * arm, y);
      ctx.stroke();
    }
    return canvas.toDataURL('image/png');
  })()`);

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(PNG_PATH, Buffer.from(pngDataUrl.split(',')[1], 'base64'));

  // .iconset に必要な各解像度を書き出して icns にまとめる
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
  fs.mkdirSync(ICONSET_DIR);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const name = `icon_${size}x${size}${suffix}.png`;
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), PNG_PATH, '--out', path.join(ICONSET_DIR, name)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', ICNS_PATH]);
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });

  // Windows 用の .ico
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'qr-icon-'));
  const images = ICO_SIZES.map((size) => {
    const out = path.join(tempDir, `${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), PNG_PATH, '--out', out], { stdio: 'ignore' });
    return { size, data: fs.readFileSync(out) };
  });
  fs.writeFileSync(ICO_PATH, buildIco(images));
  fs.rmSync(tempDir, { recursive: true, force: true });

  const rel = (target) => path.relative(path.join(__dirname, '..'), target);
  console.log('アイコンを生成しました:', rel(ICNS_PATH), '/', rel(ICO_PATH));
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
