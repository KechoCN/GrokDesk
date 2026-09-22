# 构建与发布

## 环境

Node.js 22.12+ 和 npm；CI 使用 Node.js 24。各目标优先使用相同系统、相同架构的主机。Windows、macOS 使用 node-pty 的 Node-API 预编译模块；Linux 必须用 C/C++ 编译器、make、Python 3 构建原生模块。

在 Debian/Ubuntu 构建机安装 build-essential、python3，以及 Electron 所需 GTK/NSS/ALSA/GBM 等桌面依赖，具体包名见 `.github/workflows/build.yml`。无显示器的测试环境使用 Xvfb。macOS 需要 Xcode Command Line Tools；正式分发需要 Apple Developer ID 证书与公证凭据。

```sh
npm ci
npm test
npm run build
npm run test:smoke
npm start
```

`npm run dev` 启动 Vite；另一个终端将 `GROKDESK_DEV_URL` 设为 `http://127.0.0.1:5173` 后运行 `npm start`。PowerShell 使用 `$env:GROKDESK_DEV_URL='http://127.0.0.1:5173'`，POSIX shell 使用 `GROKDESK_DEV_URL=http://127.0.0.1:5173 npm start`。

## 安装包

```sh
npm run package -- --platform win --arch x64
npm run package -- --platform win --arch arm64
npm run package -- --platform mac --arch x64
npm run package -- --platform mac --arch arm64
npm run package -- --platform linux --arch x64
npm run package -- --platform linux --arch arm64
```

以上是分别在对应操作系统执行的命令，不能在 Windows 上生成可验收的 macOS/Linux 原生产物。Linux 完整 deb 构建需设置 `GROKDESK_REPOSITORY_URL` 为真实 HTTPS 仓库主页；GitHub Actions 会自动使用当前仓库地址。

- `--dir`：只生成可运行应用目录，用于本地检查。
- `--skip-tests`：仅当本轮单元及界面测试已通过时使用；仍执行编译、打包结构检查和同架构原生终端测试。
- `--require-native`：拒绝在不同架构主机上生成“已验证”产物；CI 使用此参数。
- Windows `build.ps1 -InstallDependencies` 为兼容入口，内部委托同一个 Node 构建脚本。

完整打包先写入 `dist/<version>/.staging-<target>-...`，校验完成后切换为 `dist/<version>/<target>/`。同一 checkout 使用构建锁，按架构顺序运行。失败时保留暂存目录供诊断，旧的成功产物不被覆盖；只在确认没有构建进程后处理遗留 `.package.lock`。

最终目录包含两个发行文件、解包应用目录、SHA-256 校验文件、构建 JSON。解包目录用于验收，GitHub Release 只上传发行文件和校验记录。

## 原生终端验证

同系统同架构打包后，用包内 Electron 载入包内 node-pty，创建系统 shell，验证输入、输出、resize 和退出。跨架构本机构建只检查文件完整性，在 JSON 标明 `not-run-cross-architecture`，不会冒充已运行。

## 签名

默认 Windows 不签名，macOS 使用 ad-hoc 签名且不公证。正式证书通过环境变量提供，不写入仓库。

- Windows：设置 `GROKDESK_WIN_SIGN=1`，以及 electron-builder 的 `CSC_LINK`、`CSC_KEY_PASSWORD`。
- macOS：设置 `GROKDESK_MAC_SIGN_IDENTITY` 为 Developer ID 名称，使用 `CSC_LINK`、`CSC_KEY_PASSWORD` 导入证书；脚本开启 hardened runtime 并要求签名成功。
- macOS 公证：再设 `GROKDESK_MAC_NOTARIZE=1`，提供 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，或 electron-builder 支持的 Apple API 凭据。

CI 模板默认生成未正式签名的候选构建。维护者需将上述值配置为 GitHub Secrets，并映射到打包步骤的环境变量后，才会生成正式签名包。

## GitHub 流程

仓库已准备 `.gitignore`、`.gitattributes`、许可证、贡献说明、Issue/PR 模板和六目标构建矩阵。默认分支为 `main`，上游为 [KechoCN/GrokDesk](https://github.com/KechoCN/GrokDesk)。

Pull Request 与主分支推送执行测试及目录构建。版本标签（本版 `v0.1.0`）或手动完整构建生成发行包。六目标全部通过后，标签工作流才会汇总文件并创建 **Draft Release**，由维护者检查后发布。公开源码与正式发布安装包是不同步骤。

Runner 配置包括 Windows x64/ARM64、macOS Intel/Apple Silicon、Linux x64/ARM64；实际可用性及用量取决于仓库类型和 GitHub 账号。若账号不支持相应 ARM runner，请配置同架构 self-hosted runner，不应跳过原生验证。

参考：[electron-builder 多平台构建](https://www.electron.build/multi-platform-build)、[macOS 签名](https://www.electron.build/code-signing-mac)、[Windows 签名](https://www.electron.build/code-signing-win)。
