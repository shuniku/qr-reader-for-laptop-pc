# QR Reader for Laptop PC

[English](README.md) | **日本語** | [简体中文](README.zh-CN.md)

ノートPCのインカメラや画像ファイルからQRコードを読み取るデスクトップアプリ。履歴はローカルに保存し、URLは確認なしに開きません。

## できること

- **カメラで読み取る** — インカメラ／外付けカメラを選択してリアルタイムにスキャン。検出した位置を枠で表示します。
- **画像から読み取る** — ファイル選択・ウィンドウへのドラッグ＆ドロップ・クリップボードの画像（⇧⌘V）に対応。小さい画像、白黒反転、背景が透過したPNGも読み取れます。
- **内容の表示と保存** — 読み取った内容は自動でローカル（`history.json`）に保存され、「履歴」タブで検索・再表示・削除・JSON/CSVエクスポートができます。
- **URLの扱い** — URLを読み取ると、**既定のブラウザで開く**か**クリップボードにコピー**するかをダイアログで選べます。自動では開きません。
- **種別の自動判定** — URL / メール / 電話 / SMS / 位置情報 / Wi-Fi設定 / 連絡先（vCard・MeCard）/ カレンダー予定 / テキストを判別し、それぞれに応じた操作（対応アプリで開く、項目ごとのコピー、`.vcf` `.ics` として保存など）を提示します。

## 必要なもの

- macOS / Windows / Linux
- Node.js 18 以降

## 使い方

### アプリとして使う（ダブルクリックで起動）

```sh
npm run setup      # 依存パッケージの導入と環境の点検
npm run dist:dmg   # 配布物をビルド
```

`npm run setup` は依存パッケージを入れたうえで、Electron の実行バイナリが実際に
落ちてきているか（npm の設定によっては postinstall が抑止され、入らないことがあります）、
jsQR の配置、アイコンの有無、そのマシンでどのビルドができるかまでを点検します。

`dist/` に以下が生成されます。

| ファイル | 用途 |
| --- | --- |
| `dist/mac-arm64/QR Reader.app` | そのままダブルクリックで起動できます |
| `dist/QR Reader-1.0.0-arm64.dmg` | 開いて **QR Reader.app** を `アプリケーション` フォルダへドラッグするとインストールできます |
| `dist/QR Reader-1.0.0-arm64-mac.zip` | 配布用 |

`アプリケーション` フォルダに入れると、Launchpad や Spotlight からも起動できます。
`.app` だけでよい場合は `npm run dist`（dmg を作らないぶん速い）で十分です。

> Apple の開発者証明書がない環境では、ビルド時に自動でアドホック署名を掛けています。
> 自分のマシンで動かすぶんには問題ありませんが、他の人に配る場合は
> ダウンロードした側で **右クリック →「開く」** が必要になります。

### Windows 版をビルドする

macOS からクロスビルドできます。

```sh
npm run dist:win
```

| ファイル | 用途 |
| --- | --- |
| `dist/QR Reader-1.0.0-win.zip` | 展開して `QR Reader.exe` をダブルクリック（ポータブル版） |
| `dist/win-unpacked/` | 展開済みの中身 |

Apple Silicon の Mac では、ZIP だけを作る以下のほうが確実です。

```sh
npm run dist:win:zip
```

> **インストーラ（setup.exe）を Mac で作る場合**
> NSIS の `makensis` は x86_64 バイナリのため **Rosetta 2** が必要です。
> 未インストールだと `spawn Unknown system error -86` で失敗します。
>
> ```sh
> softwareupdate --install-rosetta --agree-to-license
> ```
>
> Rosetta を入れたくない場合は、後述の GitHub Actions でビルドしてください。

生成対象は x64 です。ARM 版 Windows も必要なら `package.json` の
`build.win.target` の `arch` に `"arm64"` を足してください。

Windows 版も署名していないため、初回起動時に SmartScreen の警告が出ます。
「詳細情報」→「実行」で起動できます。

### 開発中に起動する

```sh
npm start
```

### カメラの許可について

初回起動時にカメラの使用許可を求められます。macOS で許可し忘れた場合は
**システム設定 →「プライバシーとセキュリティ」→「カメラ」** で許可してから再起動してください。
許可しなくても、画像ファイルからの読み取りは利用できます。

なお `npm start` で起動した場合、許可を求められるのは **Electron**（開発用の実行ファイル）です。
ビルドした `QR Reader.app` とは別枠で管理されるため、それぞれ一度ずつ許可が必要です。

### 動作確認

```sh
npm test
```

Electron 上でアプリを起動し、画像デコード・種別判定・履歴の保存／削除・外部リンクの制限・
カメラ非許可時の表示・OSごとの表示切り替えをまとめて検証します（本物の履歴には影響しません）。

このテストは **実行中の OS 上でしか動きません**。Windows 版は GitHub Actions の
`windows-latest` で実行し、全項目が通ることを確認済みです。

カメラからの実際の読み取り、URL を既定のブラウザで開く動作、画像のドラッグ＆ドロップは
自動テストでは扱えないため、macOS 実機で別途確認済みです。

ただし CI にはカメラも人もいないため、Windows では次が **未検証** です。

- カメラからの読み取り（CI は「カメラが見つかりません」の経路を通る）
- 既定ブラウザ／メールアプリでの URL の起動
- ドラッグ＆ドロップ、ファイル選択ダイアログ
- インストーラの実行と SmartScreen の挙動、実際の見た目・フォント

### GitHub Actions でビルドする

`.github/workflows/build.yml` を用意してあります。`main` への push、タグ（`v*`）、
または Actions 画面の **Run workflow** で、Windows と macOS の両方をビルドします。

- `windows-latest` で `npm run dist:win` → **setup.exe** と zip（Rosetta 不要）
- `macos-latest` で `npm run dist:dmg` → dmg と zip
- 両方で `npm test` を実行してから成果物を Artifacts にアップロード

Windows 実機がなくても、ここで **インストーラの生成とテストの通過**まで確認できます。
実際に `windows-latest` 上で全 22 項目が通り、`QR Reader-1.0.0-x64-setup.exe` が
生成されることを確認済みです。

### アイコンの再生成

```sh
npm run icon   # build/icon.icns（macOS）と build/icon.ico（Windows）を作り直す
```

macOS の `sips` / `iconutil` を使うため、実行には macOS が必要です。
生成済みのアイコンはリポジトリに含めてあるので、通常は実行不要です。

## キーボードショートカット

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 画像から読み取る | ⌘O | Ctrl+O |
| クリップボードの画像から読み取る | ⇧⌘V | Ctrl+Shift+V |
| スキャンの開始／停止 | ⌘R | Ctrl+R |
| スキャン／履歴タブの切り替え | ⌘1 / ⌘2 | Ctrl+1 / Ctrl+2 |
| ダイアログを閉じる | Esc | Esc |

画面上の表記は実行中の OS に合わせて切り替わります。

## 技術構成

| 層 | 使用技術 | 役割 |
| --- | --- | --- |
| アプリ本体 | Electron | 既定ブラウザの起動、クリップボード、ファイル保存、ネイティブメニュー |
| デコード | [jsQR](https://github.com/cozmo/jsQR) | ネイティブ依存なしのQRデコード（zbar / OpenCV 不要） |
| 映像取得 | `getUserMedia` + Canvas | カメラ映像と画像ファイルを同じ経路で解析 |
| 保存 | `app.getPath('userData')/history.json` | 一時ファイル経由で書き込み、最大1000件を保持 |

### ファイル構成

```
src/main/main.js      Electron メインプロセス、IPC、メニュー
src/main/preload.js   renderer へ公開する API（contextBridge）
src/main/store.js     履歴の保存／読み込み／CSV変換
src/renderer/app.js   画面の組み立てと操作
src/renderer/scanner.js  カメラ映像・画像からのデコード
src/renderer/parse.js    読み取った文字列の種別判定
scripts/setup.js         ビルド環境の準備と点検
scripts/smoke-test.js    通しの動作確認
scripts/make-icon.js     アプリアイコン（build/icon.icns）の生成
scripts/adhoc-sign.js    ビルド後のアドホック署名（electron-builder フック）
.github/workflows/build.yml  Windows / macOS のビルドとテスト
```

## セキュリティ上の扱い

- renderer は `contextIsolation: true` / `nodeIntegration: false`。`preload.js` で公開したAPI以外は使えません。
- 外部アプリへ渡せるのは `http` `https` `mailto` `tel` `sms` `geo` のみ。`file:` や `javascript:` は拒否します。
- URLは必ず内容を表示したうえでユーザーが操作を選びます。国際化ドメイン名（見た目が紛らわしいURL）には警告を出します。
- アプリ内から外部サイトへ遷移したり、新しいウィンドウを開いたりしません。
- 読み取った内容の送信先はありません。すべてローカルに保存されます。

## ライセンス

MIT License（[LICENSE](LICENSE)）

ビルドしたアプリには、次のライブラリがそれぞれのライセンスのもとで同梱されます。

| ライブラリ | ライセンス |
| --- | --- |
| [Electron](https://github.com/electron/electron) | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 |

これらのライセンス文も配布物に含まれています。実行ファイルと同じ場所に
`LICENSE.electron.txt` と `LICENSES.chromium.html`、`app.asar` の中に
`LICENSE` と `node_modules/jsqr/LICENSE` が入ります。
