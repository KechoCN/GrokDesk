# GrokDesk

**0.1.0** · Windows、macOS、Linux 的 Grok 桌面工作区，使用 Electron + React + TypeScript。

保留 Grok Build 的会话、原版 TUI、项目目录和登录方式，提供附件、文件预览、任务进度、技能/插件上下文、主题和中英文界面。Chat 模式通过本机 Chrome / Edge 扩展连接已登录的 Grok 网页。

这是独立社区客户端，与 xAI、X Corp. 或 ZCode 官方没有隶属关系。**Build 需要另行安装 [Grok Build](https://docs.x.ai/build/overview)**；客户端不包含 Grok 引擎，不提供额外账号、订阅或额度。

## 安装与运行

从 [GitHub Releases](https://github.com/KechoCN/GrokDesk/releases) 下载，按系统和 CPU 架构选择文件：

- **Windows**：`GrokDesk-0.1.0-win-<arch>-setup.exe` 或 `-portable.exe`，支持 x64、ARM64。
- **macOS**：`GrokDesk-0.1.0-mac-<arch>.dmg` 或 `.zip`，支持 Intel x64、Apple Silicon ARM64。将 GrokDesk 拖到 Applications。
- **Linux**：AppImage 使用 `linux-x86_64` / `linux-arm64`，deb 使用 `linux-amd64` / `linux-arm64`。AppImage 需执行权限；Debian/Ubuntu 可安装 deb。

每组构建附带 `SHA256SUMS.txt` 和 `GrokDesk-0.1.0-<platform>-<arch>-build.json`，记录实际平台、架构和原生模块验证情况。实际生成的产物与未验证项目见 [验证记录](docs/verification-0.1.0.md)。未配置签名证书的构建不带发布者签名；macOS 默认 ad-hoc 签名，对外正式分发请配置 Developer ID 签名与公证。

首次启动后添加项目目录。软件自动查找 Grok CLI，也可在设置中指定可执行文件。无项目任务存放在系统文档目录的 `GrokDesk/Chats`，应用状态使用系统用户数据目录。

## 浏览器聊天

1. 保持 GrokDesk 打开，选择“帮助与更多 → 设置 Chrome / Edge 扩展程序”。
2. 在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，加载刚打开的扩展目录。
3. 在同一浏览器登录 [Grok](https://grok.com/)，刷新已打开的 Grok 网页。
4. 返回 GrokDesk 的 Chat，保持应用、扩展及官网标签页运行。

升级后重新加载扩展并刷新 Grok 页面。扩展中的 `config.js` 包含本机连接密钥，不应提交或分享。应用通过页面内容同步消息，不读取浏览器 Cookie、密码或登录令牌。语音和屏幕共享可在系统浏览器继续使用。

## 开发与构建

使用 Node.js 22.12+ 和 npm（CI 使用 Node.js 24），在对应操作系统执行：

```sh
npm ci
npm test
npm run build
npm start
```

打包当前系统与架构：

```sh
npm run package
```

输出位于 `dist/0.1.0/<platform>-<arch>/`。各平台依赖、目标架构、调试、CI 与签名设置见 [构建指南](docs/building.md)。

## 仓库结构

```text
.github/          三系统 CI、发布流程与问题模板
Assets/           平台图标与来源说明
build/            安装器和签名所需资源
docs/             构建、平台行为与验证文档
electron/         主进程、IPC、Grok 集成、浏览器扩展
renderer/         React 界面、样式与交互
scripts/          跨平台构建、原生模块验证、校验和
shared/           主进程与界面的类型合约
tests/            单元测试和 Electron 冒烟测试
third-party/      第三方许可证与来源说明
```

`node_modules/`、`renderer-dist/`、`dist/` 和本地验证产物均不提交。安装包通过 GitHub Release 附件分发。参见 [贡献指南](CONTRIBUTING.md)、[版本记录](CHANGELOG.md) 和 [平台说明](docs/platforms.md)。

## 许可

代码采用 [Apache-2.0](LICENSE)。ZCode 组件保留原始许可与来源，见 [third-party](third-party/ZCode-SOURCE.md)。Grok 图标的权属与来源见 [Assets/NOTICE.md](Assets/NOTICE.md)；代码许可证不授予第三方商标或图标权利。

随附 Noto Sans SC 字体采用 SIL Open Font License 1.1，完整许可证、来源与校验值见 [字体说明](third-party/noto-sans-sc/NOTICE.md)。
