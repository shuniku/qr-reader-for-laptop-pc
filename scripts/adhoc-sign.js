// electron-builder の afterPack フック。
// Apple の開発者証明書がない環境では署名がスキップされ、バンドルの封印が
// Electron のままになる。その状態だとカメラ許可（TCC）が正しく紐づかず、
// 起動のたびに許可を求められることがあるため、アドホック署名を掛け直す。
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log(`  • アドホック署名を適用しました  app=${appName}`);
  } catch (error) {
    console.warn(`  • アドホック署名に失敗しました: ${error.stderr?.toString() ?? error.message}`);
  }
};
