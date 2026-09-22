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

`.github/workflows/build.yml` 在六个原生系统/架构 runner 上执行单元测试、Electron 界面 smoke、完整打包和包内原生终端验证。公开运行结果见 [Test and package](https://github.com/KechoCN/GrokDesk/actions/workflows/build.yml)。平台元数据模拟不能替代原生 runner 的结果。

发布收集器要求同批六组产物齐全、`nativeRuntimeTest` 为 `passed`、非目录构建，并逐一核对 SHA-256。发行附件中的 `*-build.json` 记录实际源提交、架构、签名状态和安装包校验值；界面截图单独保留在各次 CI 的 `smoke-*` 附件中。

原生 CI 已发现并修正 Windows 8.3 临时路径与 macOS `/private/var` 的测试断言、Linux Electron 参数解析及虚拟显示器截图。包内终端测试沿产品的 ASAR 加载路径执行，并按操作系统检查 node-pty 的实际构建产物，不要求 Linux 提供 macOS 专用辅助程序。

默认构建不使用发布者证书。Windows 为 unsigned；macOS 为 ad-hoc，未 Apple 公证。证书模式与公证必须通过实际验证后才记录为成功。

真实 Grok 登录、付费账号能力、官网页面及浏览器扩展端到端交互未在本轮使用私人账号请求测试。桌面回归使用隔离数据和模拟会话，不向真实 Grok 发送任务。

## 产物与工作目录

本地发行文件按 `dist/0.1.0/<platform>-<arch>/` 整理，各附 `SHA256SUMS.txt` 和 `*-build.json`。Git 仅包含源码、资源、文档和测试；node_modules、发行文件、旧构建缓存及运行数据均被排除。

0.3.0 旧构建和 0.6.0 依赖备份已移入系统回收站，可恢复；0.6.2 旧安装器已移除。用户退出旧版后，0.6.2 便携程序也已移入系统回收站。工作目录中的旧版本清理完成，`dist/` 仅保留 `0.1.0/`，原有系统用户数据保留。
