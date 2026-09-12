#!/usr/bin/env node
// ビルド環境の準備と点検をまとめて行う。実行: npm run setup
//
// npm install だけでは足りない点を補うためのもの。とくに npm の設定によっては
// electron の postinstall が抑止され、実行バイナリが落ちてこないまま
// `electron .` が失敗する（このプロジェクトで実際に踏んだ）。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIN_NODE_MAJOR = 18;

const problems = [];
const notes = [];

const ok = (message) => console.log(`  ✓ ${message}`);
const info = (message) => console.log(`    ${message}`);
const warn = (message) => { console.log(`  ! ${message}`); notes.push(message); };
const fail = (message) => { console.log(`  ✗ ${message}`); problems.push(message); };

function section(title) {
  console.log(`\n${title}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
  return result;
}

/* ---------------------------------------------------------------- */

section('[1] Node.js');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= MIN_NODE_MAJOR) {
  ok(`Node.js ${process.versions.node} (${process.platform}/${process.arch})`);
} else {
  fail(`Node.js ${process.versions.node} — ${MIN_NODE_MAJOR} 以上が必要です`);
}

/* ---------------------------------------------------------------- */

section('[2] 依存パッケージ');
const hasLockfile = fs.existsSync(path.join(ROOT, 'package-lock.json'));
const hasModules = fs.existsSync(path.join(ROOT, 'node_modules'));

if (!hasModules) {
  info(hasLockfile ? 'npm ci を実行します…' : 'npm install を実行します…');
  const result = run('npm', hasLockfile ? ['ci'] : ['install']);
  if (result.status !== 0) {
    fail('依存パッケージのインストールに失敗しました');
  } else {
    ok('依存パッケージをインストールしました');
  }
} else {
  ok('node_modules は既にあります');
  info('入れ直す場合: rm -rf node_modules && npm ci');
}

/* ---------------------------------------------------------------- */

section('[3] Electron の実行バイナリ');
// npm の allowScripts 設定などで postinstall が走らないと、
// node_modules/electron はあるのに実行バイナリだけ無い状態になる。
const electronDir = path.join(ROOT, 'node_modules', 'electron');
const pathFile = path.join(electronDir, 'path.txt');
const installScript = path.join(electronDir, 'install.js');

function electronBinaryPath() {
  if (!fs.existsSync(pathFile)) return null;
  const relative = fs.readFileSync(pathFile, 'utf8').trim();
  const binary = path.join(electronDir, 'dist', relative);
  return fs.existsSync(binary) ? binary : null;
}

if (!fs.existsSync(electronDir)) {
  fail('electron が入っていません。[2] の失敗を解消してください');
} else if (electronBinaryPath()) {
  ok('実行バイナリを確認しました');
} else {
  // ここは自動で直せるので、最後の「注意」には残さない
  info('実行バイナリがありません（postinstall が抑止された可能性があります）。取得します…');
  const result = run('node', [installScript]);
  if (result.status === 0 && electronBinaryPath()) {
    ok('実行バイナリを取得しました');
  } else {
    fail('Electron の実行バイナリを取得できませんでした');
  }
}

/* ---------------------------------------------------------------- */

section('[4] renderer 用の jsQR');
const vendorResult = run('node', [path.join(ROOT, 'scripts', 'copy-vendor.js')], { quiet: true });
if (vendorResult.status === 0) {
  ok('src/renderer/vendor/jsQR.js を配置しました');
} else {
  fail(`jsQR を配置できませんでした: ${(vendorResult.stderr || '').trim()}`);
}

/* ---------------------------------------------------------------- */

section('[5] アイコン');
for (const [file, platform] of [['icon.icns', 'macOS'], ['icon.ico', 'Windows'], ['icon.png', '元画像']]) {
  const target = path.join(ROOT, 'build', file);
  if (fs.existsSync(target)) ok(`build/${file} (${platform})`);
  else warn(`build/${file} がありません — macOS で npm run icon を実行すると作れます`);
}

/* ---------------------------------------------------------------- */

section('[6] パッケージング');
if (process.platform === 'darwin') {
  ok('npm run dist:dmg — macOS 版（dmg / zip）');
  ok('npm run dist:win:zip — Windows 版の ZIP（クロスビルド）');

  if (process.arch === 'arm64') {
    // NSIS の makensis は x86_64 バイナリのため Rosetta 2 が要る
    const hasRosetta = fs.existsSync('/Library/Apple/usr/libexec/oah');
    if (hasRosetta) {
      ok('npm run dist:win — Windows インストーラ（Rosetta 2 あり）');
    } else {
      warn('npm run dist:win（インストーラ）は Rosetta 2 が無いため失敗します');
      info('入れる場合: softwareupdate --install-rosetta --agree-to-license');
      info('入れない場合: npm run dist:win:zip か GitHub Actions を使ってください');
    }
  }

  try {
    execFileSync('which', ['iconutil'], { stdio: 'ignore' });
    ok('iconutil / sips あり — npm run icon が使えます');
  } catch {
    warn('iconutil が見つかりません — npm run icon は使えません');
  }
} else if (process.platform === 'win32') {
  ok('npm run dist:win — Windows 版（setup.exe / zip）');
  warn('macOS 版のビルドは macOS でのみ可能です');
} else {
  warn(`${process.platform} ではパッケージングの動作確認をしていません`);
  info('GitHub Actions（Windows / macOS）でのビルドを利用してください');
}

/* ---------------------------------------------------------------- */

section('[7] カメラ');
if (process.platform === 'darwin') {
  info('初回起動時に許可を求められます。許可しなくても画像からの読み取りは使えます。');
  info('拒否した場合: システム設定 →「プライバシーとセキュリティ」→「カメラ」');
} else if (process.platform === 'win32') {
  info('設定 →「プライバシーとセキュリティ」→「カメラ」で許可が必要な場合があります。');
}

/* ---------------------------------------------------------------- */

console.log(`\n${'-'.repeat(60)}`);
if (problems.length > 0) {
  console.log(`\n❌ ${problems.length} 件の問題があります:`);
  problems.forEach((p) => console.log(`   - ${p}`));
  process.exit(1);
}

console.log('\n✅ セットアップ完了');
if (notes.length > 0) {
  console.log(`\n   注意 ${notes.length} 件:`);
  notes.forEach((n) => console.log(`   - ${n}`));
}
console.log('\n   次にできること:');
console.log('     npm start   アプリを起動');
console.log('     npm test    動作確認（Electron を起動して通しで検証）');
console.log(`     ${os.platform() === 'darwin' ? 'npm run dist:dmg' : 'npm run dist:win'}   配布物をビルド`);
console.log('');
