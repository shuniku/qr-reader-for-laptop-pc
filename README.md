# QR Reader for Laptop PC

**English** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Desktop QR code reader for laptops — scan with the built-in camera or read from image files. Keeps history locally and never opens a URL without asking.

## Features

- **Scan with a camera** — Pick your built-in or external camera and scan in real time. Detected codes are outlined on the preview.
- **Read from images** — Open a file, drag and drop onto the window, or paste an image from the clipboard (⇧⌘V). Small images, inverted (white-on-black) codes, and PNGs with transparent backgrounds all work.
- **Show and save results** — Every scan is saved locally to `history.json` automatically. The History tab lets you search, reopen, delete, and export to JSON or CSV.
- **How URLs are handled** — When a URL is scanned, a dialog asks whether to **open it in your default browser** or **copy it to the clipboard**. Nothing opens automatically.
- **Automatic content-type detection** — Recognizes URLs, email addresses, phone numbers, SMS, geo coordinates, Wi-Fi settings, contacts (vCard / MeCard), calendar events, and plain text, and offers the matching actions (open in the relevant app, copy an individual field, save as `.vcf` or `.ics`, and so on).

## Requirements

- macOS / Windows / Linux
- Node.js 18 or later

## Getting started

### Build the app (launch by double-clicking)

```sh
npm install
npm run dist:dmg
```

This produces the following in `dist/`:

| File | Purpose |
| --- | --- |
| `dist/mac-arm64/QR Reader.app` | Double-click to launch |
| `dist/QR Reader-1.0.0-arm64.dmg` | Open it and drag **QR Reader.app** into `Applications` to install |
| `dist/QR Reader-1.0.0-arm64-mac.zip` | For distribution |

Once it is in `Applications`, you can also launch it from Launchpad or Spotlight.
If you only need the `.app`, `npm run dist` is enough and is faster because it skips the dmg.

> Without an Apple developer certificate, the build applies an ad-hoc signature automatically.
> That is fine for running it on your own machine, but anyone you share it with will need to
> **right-click → Open** the first time.

### Build for Windows

You can cross-build from macOS.

```sh
npm run dist:win
```

| File | Purpose |
| --- | --- |
| `dist/QR Reader-1.0.0-win.zip` | Unzip and double-click `QR Reader.exe` (portable) |
| `dist/win-unpacked/` | The unpacked contents |

On Apple Silicon Macs, building only the ZIP is more reliable:

```sh
npm run dist:win:zip
```

> **Building the installer (setup.exe) on a Mac**
> NSIS's `makensis` is an x86_64 binary, so it needs **Rosetta 2**.
> Without it the build fails with `spawn Unknown system error -86`.
>
> ```sh
> softwareupdate --install-rosetta --agree-to-license
> ```
>
> If you would rather not install Rosetta, build with GitHub Actions instead (see below).

The build targets x64. If you also need Windows on ARM, add `"arm64"` to the `arch` list
under `build.win.target` in `package.json`.

The Windows build is unsigned as well, so SmartScreen will warn you on first launch.
Choose **More info → Run anyway**.

### Run in development

```sh
npm start
```

### About camera permission

You will be asked for camera permission the first time you launch the app. On macOS, if you
missed the prompt, grant it under **System Settings → Privacy & Security → Camera** and
restart the app. Reading from image files works without camera permission.

Note that when you launch with `npm start`, the permission is requested for **Electron**
(the development executable), which macOS tracks separately from the built `QR Reader.app`.
Each one needs to be granted once.

### Running the tests

```sh
npm test
```

This launches the app under Electron and checks image decoding, content-type detection,
saving and deleting history, the external-link restrictions, what is shown when the camera
is unavailable, and the per-OS label switching. It does not touch your real history.

The test **only runs on the OS you run it from**. The Windows build is exercised on GitHub
Actions' `windows-latest`, where all checks pass.

However, CI has neither a camera nor a human, so the following are **unverified** on Windows:

- Reading from a camera (CI goes down the "no camera found" path)
- Opening URLs in the default browser or mail client
- Drag and drop, and the native file dialogs
- Running the installer, SmartScreen behavior, and the actual appearance and fonts

### Build with GitHub Actions

`.github/workflows/build.yml` is included. It builds both Windows and macOS on a push to
`main`, on a `v*` tag, or via **Run workflow** in the Actions tab.

- `windows-latest` runs `npm run dist:win` → **setup.exe** and a zip (no Rosetta needed)
- `macos-latest` runs `npm run dist:dmg` → dmg and zip
- Both run `npm test` before uploading the results as artifacts

This lets you confirm that **the installer builds and the tests pass** without owning a
Windows machine. All 22 checks have been confirmed to pass on `windows-latest`, producing
`QR Reader-1.0.0-x64-setup.exe`.

### Regenerating the icon

```sh
npm run icon   # rebuilds build/icon.icns (macOS) and build/icon.ico (Windows)
```

This uses macOS's `sips` and `iconutil`, so it must be run on macOS. The generated icons are
committed to the repository, so you normally do not need to run it.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Read from an image file | ⌘O | Ctrl+O |
| Read the image on the clipboard | ⇧⌘V | Ctrl+Shift+V |
| Start / stop scanning | ⌘R | Ctrl+R |
| Switch between Scan and History | ⌘1 / ⌘2 | Ctrl+1 / Ctrl+2 |
| Close the dialog | Esc | Esc |

The labels shown in the app switch to match the OS it is running on.

## How it is built

| Layer | Technology | Role |
| --- | --- | --- |
| Application shell | Electron | Launching the default browser, clipboard, saving files, native menus |
| Decoding | [jsQR](https://github.com/cozmo/jsQR) | QR decoding with no native dependencies (no zbar or OpenCV) |
| Capture | `getUserMedia` + Canvas | Camera frames and image files go through the same path |
| Storage | `app.getPath('userData')/history.json` | Written via a temporary file, keeps up to 1000 entries |

### Project layout

```
src/main/main.js      Electron main process, IPC, menus
src/main/preload.js   The API exposed to the renderer (contextBridge)
src/main/store.js     Saving / loading history and CSV conversion
src/renderer/app.js   Building the UI and handling interaction
src/renderer/scanner.js  Decoding from camera frames and images
src/renderer/parse.js    Content-type detection for scanned strings
scripts/smoke-test.js    End-to-end checks
scripts/make-icon.js     Generates the app icons
scripts/adhoc-sign.js    Ad-hoc signing after packaging (electron-builder hook)
.github/workflows/build.yml  Windows / macOS builds and tests
```

## Security notes

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. Nothing beyond the API exposed in `preload.js` is reachable from it.
- Only `http`, `https`, `mailto`, `tel`, `sms`, and `geo` can be handed to external apps. `file:` and `javascript:` are rejected.
- URLs are always displayed first, and you choose what happens next. Internationalized domain names (which can look deceptively similar to other sites) trigger a warning.
- The app never navigates to external sites or opens new windows.
- Nothing is sent anywhere. Everything stays on your machine.

## License

MIT — see [LICENSE](LICENSE).

The packaged app also redistributes the following libraries under their own licenses:

| Library | License |
| --- | --- |
| [Electron](https://github.com/electron/electron) | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 |

Their license texts ship inside the build: `LICENSE.electron.txt` and
`LICENSES.chromium.html` next to the executable, and `LICENSE` plus
`node_modules/jsqr/LICENSE` inside `app.asar`.
