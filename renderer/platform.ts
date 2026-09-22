// The desktop bridge is the source of truth; browser previews have no native frame.
export type DesktopPlatform = 'win32' | 'darwin' | 'linux';
export const platform: DesktopPlatform | undefined = typeof window === 'undefined' ? undefined : window.grokdesk?.platform;
export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';
export const platformName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : 'Desktop';
export const primaryKey = isMac ? '⌘' : 'Ctrl';
export const engineExecutable = isWindows ? 'grok.exe' : 'grok';
export const terminalFontFamily = isMac
  ? 'Menlo, Monaco, "SFMono-Regular", "PingFang SC", monospace'
  : isWindows
    ? '"Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace'
    : platform === 'linux'
      ? '"DejaVu Sans Mono", "Liberation Mono", "Noto Sans CJK SC", "GrokDesk Noto Sans SC", monospace'
      : 'monospace';

type Modifiers = { ctrlKey: boolean; metaKey: boolean; altKey?: boolean; shiftKey?: boolean };

export function hasPrimaryModifier(event: Modifiers, target = platform): boolean {
  return !event.altKey && (target === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

// Control-C must always reach the TUI as SIGINT, including on macOS.
export function terminalClipboardAction(event: Modifiers & { type: string; code: string }, target = platform): 'copy' | 'paste' | undefined {
  if (event.type !== 'keydown' || event.altKey) return undefined;
  const matches = target === 'darwin'
    ? event.metaKey && !event.ctrlKey && !event.shiftKey
    : event.ctrlKey && event.shiftKey && !event.metaKey;
  if (!matches) return undefined;
  return event.code === 'KeyC' ? 'copy' : event.code === 'KeyV' ? 'paste' : undefined;
}

export const terminalCopyShortcut = isMac ? '⌘+C' : 'Ctrl+Shift+C';
export const terminalPasteShortcut = isMac ? '⌘+V' : 'Ctrl+Shift+V';
