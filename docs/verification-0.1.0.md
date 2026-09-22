# 0.1.0 验证记录

## 本地环境

2026-09-22，Windows x64，Node.js 22.23.2、npm 12.0.2、Electron 44.4.3、electron-builder 26.15.3。

## 已通过

- `npm test`：105 项，102 通过，3 项 POSIX 真机检查在 Windows 跳过，0 失败。
- `npm run build`：TypeScript 与 Vite 构建成功。存在前端 bundle 大小提示，不影响编译结果。
- `npm run test:smoke`：主进程 IPC、现有界面、Windows/macOS/Linux 平台元数据模拟验证通过。
- 布局、浏览器聊天界面、文本/文件/截图粘贴回归测试通过。
- Windows x64 完整 NSIS 与 portable 构建通过，包内 Electron 载入包内 node-pty，真实创建 shell、收发数据、resize 并正常退出。
- 对最终 Windows x64 ASAR 重新执行主进程 IPC 与浏览器桥接 smoke，通过依赖解析、项目/附件保存、扩展完整复制和连接密钥排除检查。
- Windows ARM64 安装器、便携版和原生模块结构检查通过；本机不能执行 ARM64，manifest 明确标记 `not-run-cross-architecture`。
- electron-builder 配置 schema、六目标架构选择、版本一致性和发布文件校验流程通过。

## 原生 CI

`.github/workflows/build.yml` 在六个原生系统/架构 runner 上运行。平台元数据模拟不代表 macOS/Linux 真机验证；各工作流结果是最终依据。待运行的 CI 包括 POSIX 真机测试、原生标题栏/菜单启动、Linux node-pty 编译、macOS 签名检查以及全部目标安装包。

默认构建不使用发布者证书。Windows 为 unsigned；macOS 为 ad-hoc，未 Apple 公证。证书模式与公证必须通过实际验证后才记录为成功。

真实 Grok 登录、付费账号能力、官网页面及浏览器扩展端到端交互未在本轮使用私人账号请求测试。桌面回归使用隔离数据和模拟会话，不向真实 Grok 发送任务。

## 产物与工作目录

本地发行文件在 `dist/0.1.0/win-x64/`、`dist/0.1.0/win-arm64/`，各附 `SHA256SUMS.txt` 和 `*-build.json`。Git 仅包含源码、资源、文档和测试；node_modules、发行文件、旧构建缓存及运行数据均被排除。

旧版递归缓存清理曾被执行策略拒绝。0.6.2 旧安装器已移除；旧便携程序仍被运行中的进程占用，不强制终止用户会话。可在退出旧程序后清理遗留文件，不影响新版本源码与 CI。
