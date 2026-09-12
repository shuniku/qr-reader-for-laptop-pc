// node_modules から renderer が直接読み込める場所へ jsQR をコピーする。
// renderer は contextIsolation 有効・nodeIntegration 無効のため node_modules を参照できない。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'jsqr', 'dist', 'jsQR.js');
const destDir = path.join(root, 'src', 'renderer', 'vendor');
const dest = path.join(destDir, 'jsQR.js');

if (!fs.existsSync(src)) {
  console.error('jsqr が見つかりません。先に `npm install` を実行してください。');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('vendor: jsQR.js を配置しました ->', path.relative(root, dest));
