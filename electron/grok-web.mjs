import { app, BrowserWindow, shell, Menu, dialog, desktopCapturer } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isGrokUrl, isWebUrl, isExternalUrl, isGrokBlob, callbackFromAuthUrl, isAuthCallback } from './grok-web-policy.mjs';

// Remote pages never inherit the application's preload or its filesystem/IPC API.
export function remoteWebPreferences(partition) {
  return { partition, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: true };
}
const configuredSessions = new WeakSet();
function configureSession(webSession, parent, notice) {
  if (configuredSessions.has(webSession)) return;
  configuredSessions.add(webSession);
  const granted = new Set();
  const labels = { media: '麦克风或摄像头', notifications: '发送系统通知', geolocation: '获取位置', 'clipboard-read': '读取剪贴板', 'clipboard-sanitized-write': '写入剪贴板', fullscreen: '全屏显示', 'speaker-selection': '选择音频输出设备', 'storage-access': '登录所需的跨站存储', 'top-level-storage-access': '登录所需的跨站存储' };
  const allowed = (contents, origin) => !contents?.isDestroyed() && isWebUrl(contents?.getURL()) && isWebUrl(origin);
  webSession.setPermissionCheckHandler((contents, permission, origin) => allowed(contents, origin) && (permission === 'clipboard-sanitized-write' || granted.has(new URL(origin).origin + ':' + permission)));
  webSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || contents.getURL();
    if (!allowed(contents, origin) || !labels[permission]) return callback(false);
    const key = new URL(origin).origin + ':' + permission;
    if (permission === 'clipboard-sanitized-write' || granted.has(key)) return callback(true);
    dialog.showMessageBox(BrowserWindow.fromWebContents(contents) || parent, {
      type: 'question', title: 'Grok 网页权限', message: `${new URL(origin).hostname} 请求${labels[permission]}`,
      detail: '仅允许当前客户端会话使用。你可以拒绝后继续使用其他聊天功能。', buttons: ['拒绝', '允许'], defaultId: 0, cancelId: 0,
    }).then(({ response }) => { if (response === 1) granted.add(key); callback(response === 1); }).catch(() => callback(false));
  });
  webSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isGrokUrl(request.securityOrigin)) return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const choices = sources.slice(0, 10);
      const { response } = await dialog.showMessageBox(parent, { type: 'question', title: '共享屏幕', message: '选择要与 Grok 共享的屏幕或窗口', detail: '所选画面将发送给 Grok，直到你停止共享。', buttons: ['取消', ...choices.map(source => source.name)], defaultId: 0, cancelId: 0 });
      callback(response > 0 && choices[response - 1] ? { video: choices[response - 1] } : {});
    } catch { callback({}); }
  }, { useSystemPicker: true });
  webSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '保存 Grok 文件', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    item.once('done', (_event, state) => { if (state === 'interrupted') notice('Grok 文件下载中断，请重新下载。'); });
  });
}

function guardContents(contents, { parent, partition, notice, callback = null, popupSet }) {
  const navigate = (event, target) => {
    // Challenge/auth/media frames keep ordinary Chromium origin restrictions.
    // Only top-level navigation may leave this native view for the system browser.
    if (event.isMainFrame === false) return;
    target ||= event.url;
    if (isWebUrl(target) || isGrokBlob(target) || isAuthCallback(target, callback)) return;
    event.preventDefault();
    if (isExternalUrl(target)) void shell.openExternal(target).catch(error => notice(error.message));
  };
  contents.on('will-navigate', navigate);
  contents.on('will-redirect', navigate);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    // OAuth clients often create an empty popup before assigning its URL.
    // It gets the same sandbox and all subsequent navigation guards.
    if (url === 'about:blank' || isWebUrl(url) || isGrokBlob(url)) return { action: 'allow', overrideBrowserWindowOptions: { parent, width: 1060, height: 800, autoHideMenuBar: true, title: 'Grok', webPreferences: remoteWebPreferences(partition) } };
    if (isExternalUrl(url)) void shell.openExternal(url).catch(error => notice(error.message));
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => {
    popupSet.add(child);
    child.on('closed', () => popupSet.delete(child));
    guardContents(child.webContents, { parent, partition, notice, callback, popupSet });
  });
  contents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) template.push({ role: 'copy' });
    if (isExternalUrl(params.linkURL)) template.push({ label: '在浏览器中打开链接', click: () => void shell.openExternal(params.linkURL).catch(error => notice(error.message)) });
    if (params.hasImageContents) template.push({ label: '复制图片', click: () => contents.copyImageAt(params.x, params.y) });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) || parent });
  });
}

export function createAuthWindow({ window, url, emit = () => {} }) {
  if (!isWebUrl(url)) throw new Error('登录地址不属于 Grok 或受信任的登录提供方，请使用官方 TUI 登录。');
  const partition = `grokdesk-auth-${randomUUID()}`;
  const popupSet = new Set();
  const notice = message => emit({ type: 'notice', message });
  const authWindow = new BrowserWindow({ parent: window, width: 1020, height: 820, title: '登录 Grok Build', autoHideMenuBar: true, show: false, webPreferences: remoteWebPreferences(partition) });
  configureSession(authWindow.webContents.session, authWindow, notice);
  guardContents(authWindow.webContents, { parent: authWindow, partition, notice, callback: callbackFromAuthUrl(url), popupSet });
  authWindow.once('ready-to-show', () => { if (!authWindow.isDestroyed()) authWindow.show(); });
  authWindow.once('closed', () => { for (const popup of popupSet) if (!popup.isDestroyed()) popup.destroy(); });
  void authWindow.loadURL(url).catch(error => notice('登录页面加载失败：' + error.message));
  return authWindow;
}

import { createBrowserBridge } from './browser-bridge.mjs';
export function createGrokWeb(options) { return createBrowserBridge({ ...options, dataPath: options.dataPath || app.getPath('userData') }); }
