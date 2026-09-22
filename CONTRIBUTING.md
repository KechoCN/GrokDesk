# Contributing

使用 Node.js 22.12+ 和 npm。先阅读 [构建指南](docs/building.md)，执行 `npm ci`、`npm test`、`npm run build`，再通过 Electron 冒烟测试验证界面。

主进程在 `electron/`，界面在 `renderer/`，IPC 类型在 `shared/api.ts`。界面只能通过受限 preload 调用主进程；远程页面不得获得本地文件或 IPC 权限。修改平台逻辑时同时考虑 win32、darwin、linux，并添加验证实际行为的测试。

提交前移除密钥、账号数据、本地路径、日志与安装包。不要提交运行时生成的浏览器扩展 `config.js`。测试使用临时目录和模拟账号，不应向真实 Grok 会话发送请求。

界面与 Linux 打包共用 `Assets/grok-mobile.png`，避免维护重复副本。Windows ICO、macOS ICNS 保留在版本控制中，ICNS 通过 `npm run icons:generate` 更新。遵循 `.gitignore`，不提交 `node_modules/`、`renderer-dist/`、`dist/` 和 `artifacts/` 等本地产物。

Pull Request 请说明具体问题、修改后的行为、验证命令和未验证平台。版本更新同步 `package.json`、锁文件和浏览器扩展 manifest；About 和 ACP 从运行时版本读取。
