// ZCode source, Apache-2.0. Upstream 872ad960de7ec172591f7e1952f7849229f94521
// packages/ui/src/DesktopWindowFrame.tsx — copied for GrokDesk; import alias is local.
import { memo, type ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

export const DesktopWindowFrame = memo(function DesktopWindowFrameComponent({
  title,
  children,
  actions: _actions,
  tabBar: _tabBar,
  isDesktop = false,
  isMacDesktop = false,
  isWindowsDesktop = false,
  showHeader: _showHeader = isDesktop,
}: {
  title: string;
  children: ReactNode;
  topBar?: ReactNode;
  actions?: ReactNode;
  /** 标签栏插槽，渲染在 header 内标题后面 */
  tabBar?: ReactNode;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  showHeader?: boolean;
}) {
  return (
    <div
      className={cn(
        // 手机浏览器的 100vh 会把地址栏区域算进页面高度，
        // 远控页底部输入框容易被挤到可视区外。动态视口高度能跟随浏览器 chrome 收放，桌面端视觉不变。
        "flex h-dvh flex-col overflow-hidden border-border text-foreground",
        // Linux uses the window manager's native frame. Keep an opaque square
        // root on every platform; macOS rounds its own native window corners.
        "bg-background-win-alt",
      )}
      data-desktop-window-frame="true"
      data-platform={isMacDesktop ? 'darwin' : isWindowsDesktop ? 'win32' : isDesktop ? 'linux' : 'web'}
    >
      {isMacDesktop && <div className="mac-titlebar window-drag flex h-[34px] shrink-0 select-none items-center justify-center px-20 text-ui-xs text-foreground-subtle" aria-label={title}>{title}</div>}
      <div className="relative flex-1 min-h-0 w-full">{children}</div>
    </div>
  );
});
