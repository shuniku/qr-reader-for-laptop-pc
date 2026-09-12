# QR Reader for Laptop PC

[English](README.md) | [日本語](README.ja.md) | **简体中文**

通过笔记本电脑的内置摄像头或图片文件读取二维码的桌面应用。历史记录保存在本地，不会未经确认就打开网址。

## 功能

- **用摄像头扫描** —— 可选择内置或外接摄像头进行实时扫描，识别到的二维码会在预览画面上用方框标出。
- **从图片读取** —— 支持选择文件、拖放到窗口，以及粘贴剪贴板中的图片（⇧⌘V）。小尺寸图片、黑白反转的二维码、背景透明的 PNG 均可识别。
- **显示并保存结果** —— 每次扫描结果都会自动保存到本地的 `history.json`。在「历史」标签页中可以搜索、重新查看、删除，以及导出为 JSON 或 CSV。
- **URL 的处理方式** —— 扫描到网址时，会弹出对话框询问是**用默认浏览器打开**还是**复制到剪贴板**，不会自动打开。
- **自动识别内容类型** —— 可区分网址、邮箱地址、电话号码、短信、地理坐标、Wi-Fi 配置、联系人（vCard / MeCard）、日历事件和纯文本，并针对每种类型提供相应操作（用对应应用打开、逐项复制、保存为 `.vcf` 或 `.ics` 等）。

## 环境要求

- macOS / Windows / Linux
- Node.js 18 或更高版本

## 使用方法

### 构建应用（双击启动）

```sh
npm install
npm run dist:dmg
```

会在 `dist/` 下生成以下文件：

| 文件 | 用途 |
| --- | --- |
| `dist/mac-arm64/QR Reader.app` | 双击即可启动 |
| `dist/QR Reader-1.0.0-arm64.dmg` | 打开后将 **QR Reader.app** 拖入 `应用程序` 文件夹即可安装 |
| `dist/QR Reader-1.0.0-arm64-mac.zip` | 用于分发 |

放入 `应用程序` 文件夹后，也可以从启动台（Launchpad）或聚焦搜索（Spotlight）启动。
如果只需要 `.app`，用 `npm run dist` 即可，因为不生成 dmg，速度更快。

> 在没有 Apple 开发者证书的环境下，构建时会自动进行临时签名（ad-hoc）。
> 自己使用没有问题，但分发给他人时，对方首次打开需要**右键点击 →「打开」**。

### 构建 Windows 版

可以在 macOS 上交叉编译。

```sh
npm run dist:win
```

| 文件 | 用途 |
| --- | --- |
| `dist/QR Reader-1.0.0-win.zip` | 解压后双击 `QR Reader.exe`（免安装版） |
| `dist/win-unpacked/` | 解压后的内容 |

在 Apple Silicon 的 Mac 上，只构建 ZIP 更加稳妥：

```sh
npm run dist:win:zip
```

> **在 Mac 上构建安装程序（setup.exe）**
> NSIS 的 `makensis` 是 x86_64 二进制文件，因此需要 **Rosetta 2**。
> 未安装时会以 `spawn Unknown system error -86` 失败。
>
> ```sh
> softwareupdate --install-rosetta --agree-to-license
> ```
>
> 如果不想安装 Rosetta，请改用下文的 GitHub Actions 进行构建。

构建目标为 x64。如果还需要 ARM 版 Windows，请在 `package.json` 的
`build.win.target` 的 `arch` 中加上 `"arm64"`。

Windows 版同样未签名，因此首次启动时会出现 SmartScreen 警告，
选择「更多信息」→「仍要运行」即可。

### 开发时启动

```sh
npm start
```

### 关于摄像头权限

首次启动时会请求摄像头权限。在 macOS 上如果错过了弹窗，请在
**系统设置 →「隐私与安全性」→「摄像头」** 中授权后重启应用。
即使不授权，从图片文件读取的功能依然可用。

另外，通过 `npm start` 启动时，请求权限的是 **Electron**（开发用的可执行文件），
macOS 会将它与构建出的 `QR Reader.app` 分开管理，因此两者各需授权一次。

### 运行测试

```sh
npm test
```

该测试会在 Electron 上启动应用，依次验证图片解码、内容类型识别、历史记录的保存与删除、
外部链接的限制、摄像头不可用时的显示，以及各操作系统下的文案切换。不会影响真实的历史记录。

该测试**只能在运行它的操作系统上执行**。Windows 版已在 GitHub Actions 的
`windows-latest` 上运行，全部项目均通过。

通过摄像头的实际读取无法用自动化测试覆盖，因此已在 macOS 实机上单独确认。

但 CI 环境既没有摄像头也没有人操作，因此在 Windows 上以下内容**尚未验证**：

- 通过摄像头读取（CI 走的是「未找到摄像头」的分支）
- 用默认浏览器或邮件客户端打开 URL
- 拖放操作与系统文件选择对话框
- 安装程序的运行、SmartScreen 的表现，以及实际的外观与字体

### 使用 GitHub Actions 构建

仓库中已包含 `.github/workflows/build.yml`。在向 `main` 推送、打 `v*` 标签，
或在 Actions 页面点击 **Run workflow** 时，会同时构建 Windows 与 macOS 版本。

- `windows-latest` 执行 `npm run dist:win` → **setup.exe** 与 zip（无需 Rosetta）
- `macos-latest` 执行 `npm run dist:dmg` → dmg 与 zip
- 两者都会先运行 `npm test`，再将产物上传到 Artifacts

即使没有 Windows 实机，也能在这里确认**安装程序可以构建、测试可以通过**。
实际已确认在 `windows-latest` 上全部 22 项通过，并生成了
`QR Reader-1.0.0-x64-setup.exe`。

### 重新生成图标

```sh
npm run icon   # 重新生成 build/icon.icns（macOS）与 build/icon.ico（Windows）
```

该命令使用 macOS 的 `sips` 和 `iconutil`，因此必须在 macOS 上运行。
生成好的图标已包含在仓库中，通常无需执行。

## 键盘快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 从图片文件读取 | ⌘O | Ctrl+O |
| 读取剪贴板中的图片 | ⇧⌘V | Ctrl+Shift+V |
| 开始／停止扫描 | ⌘R | Ctrl+R |
| 在「扫描」与「历史」之间切换 | ⌘1 / ⌘2 | Ctrl+1 / Ctrl+2 |
| 关闭对话框 | Esc | Esc |

界面上显示的按键标注会根据运行的操作系统自动切换。

## 技术构成

| 层 | 使用技术 | 职责 |
| --- | --- | --- |
| 应用外壳 | Electron | 调用默认浏览器、剪贴板、保存文件、原生菜单 |
| 解码 | [jsQR](https://github.com/cozmo/jsQR) | 无原生依赖的二维码解码（不需要 zbar 或 OpenCV） |
| 采集 | `getUserMedia` + Canvas | 摄像头画面与图片文件走同一条处理路径 |
| 存储 | `app.getPath('userData')/history.json` | 经由临时文件写入，最多保留 1000 条 |

### 文件结构

```
src/main/main.js      Electron 主进程、IPC、菜单
src/main/preload.js   向渲染进程公开的 API（contextBridge）
src/main/store.js     历史记录的保存／读取与 CSV 转换
src/renderer/app.js   界面的组装与交互
src/renderer/scanner.js  从摄像头画面与图片解码
src/renderer/parse.js    扫描结果的内容类型识别
scripts/smoke-test.js    端到端的动作确认
scripts/make-icon.js     生成应用图标
scripts/adhoc-sign.js    打包后的临时签名（electron-builder 钩子）
.github/workflows/build.yml  Windows / macOS 的构建与测试
```

## 安全方面的处理

- 渲染进程以 `contextIsolation: true`、`nodeIntegration: false` 运行，除 `preload.js` 中公开的 API 外无法访问其他能力。
- 只有 `http`、`https`、`mailto`、`tel`、`sms`、`geo` 可以交给外部应用处理，`file:` 与 `javascript:` 会被拒绝。
- URL 一定会先显示内容，再由用户选择后续操作。对国际化域名（外观容易混淆的网址）会给出警告。
- 应用内不会跳转到外部网站，也不会打开新窗口。
- 不会将任何内容发送到外部，全部数据都保存在本地。

## 许可证

MIT License（见 [LICENSE](LICENSE)）

构建出的应用还会按各自的许可证一并分发以下库：

| 库 | 许可证 |
| --- | --- |
| [Electron](https://github.com/electron/electron) | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 |

这些许可证文本也包含在分发物中：可执行文件旁的 `LICENSE.electron.txt` 与
`LICENSES.chromium.html`，以及 `app.asar` 内的 `LICENSE` 和
`node_modules/jsqr/LICENSE`。
