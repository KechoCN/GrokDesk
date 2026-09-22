# 平台行为

## Windows

自定义标题栏与 Ctrl 快捷键。安装器按当前用户安装，不要求管理员权限。终端使用 ConPTY，附件支持资源管理器复制的多文件列表。关闭主窗口会退出，运行中任务先提示确认。

## macOS

使用 hiddenInset 原生红黄绿按钮、系统菜单、Command 快捷键和系统字体。关闭窗口会隐藏工作区并保留会话；点击 Dock 图标重新显示。通过菜单或 Command-Q 退出时才停止会话，运行中任务先提示确认。全屏由系统窗口按钮与菜单控制。

从 Finder/Dock 启动时补齐登录 shell 的 PATH 及 Grok/Homebrew 常见安装路径；该步骤有超时，保留现有身份认证环境。附件支持 Finder 文件 URL。Intel 与 Apple Silicon 分别构建，避免依赖 Rosetta。

## Linux

使用窗口管理器原生标题栏、Ctrl 快捷键和 PNG 图标，允许桌面环境决定装饰与缩放。CLI 路径与文件比较保留大小写。支持文件管理器 URI 列表。node-pty 在 Linux 本机编译，不能复用 Windows 二进制。

AppImage 需要桌面环境与 FUSE 支持；缺少 FUSE 时可尝试 `--appimage-extract-and-run` 或安装 deb。不要常规关闭 Chromium 沙箱。Wayland/X11 表现仍需在对应桌面验收。

## 数据与迁移

用户数据使用 Electron `app.getPath('userData')`：Windows 位于 AppData/Roaming，macOS 位于 Library/Application Support，Linux 位于 XDG 配置目录（通常 `.config`）。精确位置取决于系统配置与应用名。独立任务使用系统文档目录的 `GrokDesk/Chats`。

项目、附件来源与 Grok 原生会话可能含系统绝对路径。迁移设备时应重新选择项目目录，并在目标设备安装 Grok、登录及配置扩展；不应直接复用另一台设备的扩展连接密钥。

本次清理只针对源码工作目录内旧发行物与构建缓存，不删除系统用户数据、登录状态和外部项目。

实现参考：[Electron 窗口定制](https://www.electronjs.org/docs/latest/tutorial/window-customization)、[原生菜单](https://www.electronjs.org/docs/latest/tutorial/application-menu)、[剪贴板](https://www.electronjs.org/docs/latest/api/clipboard)。
