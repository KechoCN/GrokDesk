import { app, BrowserWindow, dialog, ipcMain, shell, Menu, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeskStore, normalizeDirectory, isDisposableConversation } from './store.mjs';
import { GrokAdapter } from './grok-adapter.mjs';
import { redact } from './acp-client.mjs';
import { snapshotFiles, snapshotData, promptBlocks } from './attachments.mjs';
import { snapshotClipboard } from './clipboard-attachments.mjs';
import { applyUpdate, message } from './transcript.mjs';
import { contextCatalog } from './context-catalog.mjs';
import { readEngineConfig, saveEngineConfig, ensureEngineConfig } from './engine-settings.mjs';
import { previewFiles, readPreview } from './preview.mjs';
import { createGrokWeb } from './grok-web.mjs';
import { createGrokAuth } from './grok-auth.mjs';
import { desktopWindowOptions, desktopMenuTemplate } from './desktop-window.mjs';
import { initializeDesktopEnvironment } from './platform.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataArgument = process.argv.indexOf('--data');
if (dataArgument >= 0) {
  const directory = process.argv[dataArgument + 1];
  if (!directory || !path.isAbsolute(directory)) throw new Error('--data requires an absolute directory');
  app.setPath('userData', directory);
}
app.setName('GrokDesk');
if (process.platform === 'win32') app.setAppUserModelId('io.grokdesk.desktop');
const singleInstance = app.requestSingleInstanceLock();
let win, store, adapter, web, auth, engine = { state: 'discovering', auth: 'unknown' };
let quitting = false, confirmingQuit = false, stateTimer, saveTimer, reconnecting, revision = 0, connectionEpoch = 0;
const permissions = new Map(), contexts = new Map(), replayStarted = new Set(), sending = new Set(), pendingSends = new Map(), attaching = new Set();
const openingConversations = new Map(), cleaningConversations = new Set(), retireRequested = new Set();
const busy = c => ['running','waiting','connecting','cancelling'].includes(c.phase);
const snapshot = () => ({ ...store.state, conversations: store.state.conversations.filter(c => !c.pendingEmptyCleanup), version: ++revision, engine, permissions: [...permissions.values()] });
function event(value) { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('grokdesk:event', value); }
function notice(error) { event({ type: 'notice', message: redact(error?.message || String(error)) }); }
function changed(save = true) {
  if (!stateTimer) stateTimer = setTimeout(() => { stateTimer = null; event({ type: 'state', state: snapshot() }); }, 25);
  if (save && !saveTimer) saveTimer = setTimeout(() => { saveTimer = null; try { store.save(); } catch (error) { notice(error); } }, 180);
}
function context(id) { if (!contexts.has(id)) contexts.set(id, {}); return contexts.get(id); }
function onAdapterEvent(value) {
  if (value.type === 'terminal') { event(value); return; }
  if (value.type === 'diagnostic') { console.log('[Grok]', redact(value.message).slice(0, 2000)); return; }
  if (value.type === 'engine') { engine = value.status; changed(false); return; }
  if (value.type === 'permission') { permissions.set(value.permission.requestId, value.permission); changed(false); return; }
  const c = store.state.conversations.find(item => item.id === value.conversationId);
  if (!c) return;
  if (value.type === 'submitted') {
    const pending = pendingSends.get(c.id);
    if (!pending) return;
    const { text, attachments } = pending;
    const content = text.trim() + (attachments.length ? '\n\n' + attachments.map(a => `📎 ${a.name}`).join('\n') : '');
    c.transient = false; delete c.pendingEmptyCleanup;
    if (attachments.length) c.attachmentHistory = [...new Map([...(c.attachmentHistory || []), ...attachments].map(({ preview, ...item }) => [item.id, item])).values()];
    c.messages.push({ ...message('user', content), ...(attachments.length ? { attachments } : {}) }); contexts.set(c.id, { suppressUserEcho: true });
    if (c.draft.trim() === text.trim()) c.draft = '';
    const submittedIds = new Set(attachments.map(a => a.id)); c.attachments = c.attachments.filter(a => !submittedIds.has(a.id));
    c.updatedAt = new Date().toISOString();
    if (!c.manualTitle && c.title === '新任务') c.title = text.trim().split(/\r?\n/)[0].slice(0,60) || '附件任务';
    pendingSends.delete(c.id);
    try { store.save(); } catch (error) { c.error = '请求已发送，但本地历史保存失败：' + redact(error.message); notice(c.error); }
    finally { changed(); pending.resolve(); }
    return;
  }
  if (value.type === 'phase') {
    c.phase = value.phase;
    if (['running', 'waiting', 'cancelling'].includes(value.phase)) { c.transient = false; delete c.pendingEmptyCleanup; }
    if (value.error) c.error = value.error; else delete c.error;
    if (value.phase !== 'waiting') for (const [id,p] of permissions) if (p.conversationId === c.id && !adapter.permissions.has(id)) permissions.delete(id);
    changed();
  } else if (value.type === 'session') {
    Object.assign(c, value.snapshot); changed();
  } else if (value.type === 'update') {
    const meaningful = ['user_message_chunk','agent_message_chunk','agent_thought_chunk','tool_call','tool_call_update','plan'].includes(value.update.sessionUpdate);
    if (meaningful) { c.transient = false; delete c.pendingEmptyCleanup; }
    if (c.pendingEmptyCleanup && value.update.sessionUpdate === 'turn_completed') { c.transient = false; delete c.pendingEmptyCleanup; changed(); }
    if (value.replay && meaningful && !replayStarted.has(c.id)) {
      replayStarted.add(c.id); c.messages = []; contexts.set(c.id, {});
    }
    if (applyUpdate(c, value.update, context(c.id))) { c.updatedAt = new Date().toISOString(); changed(); }
  }
}
async function openConversation(c) {
  if (quitting || engine.state !== 'ready') return;
  if (openingConversations.has(c.id)) return openingConversations.get(c.id);
  const operation = (async () => {
    try { Object.assign(c, await adapter.open(c)); delete c.error; }
    catch (error) { c.phase = 'error'; c.error = redact(error.message); if (!c.pendingEmptyCleanup) notice(error); }
    changed();
  })();
  openingConversations.set(c.id, operation);
  try { await operation; } finally { openingConversations.delete(c.id); }
}
function canRetire(c) {
  return isDisposableConversation(c) && !sending.has(c.id) && !attaching.has(c.id)
    && !pendingSends.has(c.id) && !openingConversations.has(c.id);
}
async function cleanEmptyConversation(c) {
  if (!c.pendingEmptyCleanup || cleaningConversations.has(c.id) || !canRetire(c)) return;
  if (c.engineSessionId && engine.state !== 'ready') return;
  cleaningConversations.add(c.id);
  try {
    if (c.engineSessionId) {
      // Replaying the native history can reveal content added outside GrokDesk.
      // Any meaningful replay clears the pending marker before deletion.
      Object.assign(c, await adapter.open(c));
      if (!c.pendingEmptyCleanup || !canRetire(c)) return;
      if (!await adapter.verifyEmptyHistory(c.id) || !c.pendingEmptyCleanup || !canRetire(c)) return;
      await adapter.delete(c.id);
    }
    if (!canRetire(c)) return;
    store.deleteConversation(c.id); contexts.delete(c.id); retireRequested.delete(c.id);
    changed();
  } catch (error) {
    // Keep the native session ID in the store, but hide this abandoned empty tab.
    // A later connection retries cleanup and importSessions cannot resurrect it.
    console.log('[GrokDesk] Empty task cleanup deferred:', redact(error.message));
  } finally { cleaningConversations.delete(c.id); }
}
async function retireEmptyConversation(id) {
  const c = store.state.conversations.find(item => item.id === id);
  if (!c) return;
  retireRequested.add(id);
  const opening = openingConversations.get(id);
  if (opening) await opening;
  if (!retireRequested.has(id) || store.state.activeConversationId === id) return;
  if (!canRetire(c)) { if (!isDisposableConversation(c)) retireRequested.delete(id); return; }
  c.pendingEmptyCleanup = true;
  if (store.state.activeConversationId === id) store.state.activeConversationId = null;
  store.save(); changed();
  void cleanEmptyConversation(c);
}
function availableConversation(id) {
  if (cleaningConversations.has(id)) throw new Error('会话正在关闭，请新建任务');
  return store.conversation(id);
}
async function connect() {
  if (reconnecting) return reconnecting;
  reconnecting = (async () => {
    connectionEpoch++;
    permissions.clear(); replayStarted.clear(); contexts.clear();
    for (const c of store.state.conversations) c.phase = c.id === store.state.activeConversationId ? 'connecting' : 'ready';
    changed(false);
    const engineCwd = path.join(store.documentsDir, 'Engine'); fs.mkdirSync(engineCwd, { recursive: true });
    engine = await adapter.start({ enginePath: store.state.settings.enginePath, cwd: engineCwd });
    if (quitting) return;
    if (engine.state === 'ready') {
      for (const c of [...store.state.conversations]) if (c.pendingEmptyCleanup) await cleanEmptyConversation(c);
      try { store.importSessions(await adapter.listSessions()); } catch (error) { notice(error); }
      if (quitting) return;
      let c = store.state.conversations.find(c => c.id === store.state.activeConversationId);
      if (c) await openConversation(c);
    } else for (const c of store.state.conversations) if (c.phase === 'connecting') { c.phase = 'error'; c.error = engine.error; }
    changed();
  })();
  try { await reconnecting; } finally { reconnecting = null; }
}
function handle(name, callback) {
  ipcMain.handle('grokdesk:' + name, async (request, ...args) => {
    if (!win || request.sender !== win.webContents || request.senderFrame !== win.webContents.mainFrame) throw new Error('Unsupported IPC sender');
    if (['starting', 'waiting'].includes(auth?.status().state) && ['send', 'terminalInput', 'setConfig', 'reconnect', 'newConversation', 'selectConversation', 'setConversationWorkspace'].includes(name)) throw new Error('正在登录或切换 Build 账号，请完成或取消登录后继续。');
    try { return await callback(...args); } catch (error) { throw new Error(redact(error.message || String(error))); }
  });
}
function registerIpc() {
  handle('bootstrap', () => snapshot());
  handle('readClipboard', () => { if (!win.isFocused()) throw new Error('请先聚焦 GrokDesk 再粘贴'); return clipboard.readText(); });
  handle('writeClipboard', text => { if (!win.isFocused() || typeof text !== 'string' || text.length > 2_000_000) throw new Error('无法复制此内容'); return clipboard.writeText(text); });
  handle('newConversation', async workspaceId => { const previous = store.state.activeConversationId; const c = store.newConversation(workspaceId || null); changed(); if (previous) void retireEmptyConversation(previous).catch(notice); await openConversation(c); return snapshot(); });
  handle('selectConversation', async id => { const c = availableConversation(id); const previous = store.state.activeConversationId; delete c.pendingEmptyCleanup; retireRequested.delete(id); store.state.activeConversationId = id; changed(); if (previous && previous !== id) void retireEmptyConversation(previous).catch(notice); await openConversation(c); return snapshot(); });
  handle('closeConversation', id => { if (store.state.activeConversationId === id) store.state.activeConversationId = null; void retireEmptyConversation(id).catch(notice); changed(); return snapshot(); });
  handle('updateConversation', async (id, patch) => {
    const c = availableConversation(id);
    if (patch?.title) { c.transient = false; delete c.pendingEmptyCleanup; }
    if (patch?.title && c.engineSessionId && engine.state === 'ready') { await openConversation(c); await adapter.rename(id, patch.title); }
    const draftOnly = patch && Object.keys(patch).length === 1 && Object.hasOwn(patch, 'draft');
    store.updateConversation(id, patch, { persist: !draftOnly }); changed(); return snapshot();
  });
  handle('deleteConversation', async id => {
    const c = store.conversation(id);
    if (busy(c) || sending.has(id) || attaching.has(id) || cleaningConversations.has(id)) throw new Error('请先等待当前操作完成');
    if (c.engineSessionId) {
      if (engine.state !== 'ready') throw new Error('请先连接 Grok 再删除会话记录');
      await openConversation(c); await adapter.delete(id);
    }
    store.deleteConversation(id); contexts.delete(id); changed(); return snapshot();
  });
  handle('setConversationWorkspace', async (id, workspaceId) => {
    const source = availableConversation(id);
    if (busy(source) || sending.has(id) || attaching.has(id) || openingConversations.has(id) || reconnecting) throw new Error('请等待当前操作完成后切换项目');
    if (source.workspaceId === workspaceId) return snapshot();
    const target = store.setConversationWorkspace(id, workspaceId);
    changed();
    void retireEmptyConversation(id).catch(notice);
    await openConversation(target);
    return snapshot();
  });
  const chooseWorkspace = async () => { const result = await dialog.showOpenDialog(win, { title: '选择项目文件夹', buttonLabel: '添加项目', properties: ['openDirectory', 'createDirectory'] }); const workspace = !result.canceled && result.filePaths[0] ? store.addWorkspace(result.filePaths[0]) : undefined; changed(); return { ...snapshot(), ...(workspace ? { selectedWorkspaceId: workspace.id } : {}) }; };
  handle('addWorkspace', chooseWorkspace);
  handle('createWorkspace', chooseWorkspace);
  handle('contextCatalog', (id, kind, query) => { const c = store.conversation(id); return contextCatalog({ cwd: c.cwd, executable: adapter.executable, environment: adapter.environment }, kind, query); });
  handle('updateWorkspace', (id, patch) => {
    const w = store.workspace(id);
    for (const [key,value] of Object.entries(patch || {})) {
      if (key === 'name' && typeof value === 'string' && value.trim()) w.name = value.trim().slice(0,100);
      else if (['pinned','archived'].includes(key) && typeof value === 'boolean') w[key] = value;
      else throw new Error('工作区设置无效');
    }
    store.save(); changed(); return snapshot();
  });
  async function addFiles(id, paths, alreadyLocked = false) {
    const c = store.conversation(id);
    if (!alreadyLocked && attaching.has(id)) throw new Error('正在添加附件，请稍候');
    if (busy(c) || sending.has(id) || cleaningConversations.has(id)) throw new Error('请等待当前操作完成后添加附件');
    attaching.add(id);
    try { const attachments = await snapshotFiles(store.dataDir, c, paths); store.conversation(id); c.attachments.push(...attachments); delete c.pendingEmptyCleanup; store.save(); changed(); return snapshot(); }
    finally { if (!alreadyLocked) { attaching.delete(id); if (retireRequested.has(id) && id !== store.state.activeConversationId) void retireEmptyConversation(id).catch(notice); } }
  }
  handle('chooseAttachments', async id => { const c = store.conversation(id); if (attaching.has(id) || sending.has(id) || busy(c) || cleaningConversations.has(id)) throw new Error('请等待当前操作完成后添加附件'); attaching.add(id); try { const result = await dialog.showOpenDialog(win, { title: '添加附件', properties: ['openFile','multiSelections'] }); return result.canceled ? snapshot() : await addFiles(id, result.filePaths, true); } finally { attaching.delete(id); if (retireRequested.has(id) && id !== store.state.activeConversationId) void retireEmptyConversation(id).catch(notice); } });
  handle('attachFiles', addFiles);
  async function addClipboardOrData(id, files, fromClipboard) {
    if (fromClipboard && !win.isFocused()) throw new Error('请先聚焦 GrokDesk 再粘贴');
    const c = store.conversation(id);
    if (attaching.has(id) || sending.has(id) || busy(c) || cleaningConversations.has(id)) throw new Error('请等待当前操作完成后添加附件');
    attaching.add(id);
    try {
      const result = fromClipboard ? await snapshotClipboard(store.dataDir, c, clipboard) : { attachments: await snapshotData(store.dataDir, c, files), handled: true };
      store.conversation(id); c.attachments.push(...result.attachments);
      if (result.attachments.length) { delete c.pendingEmptyCleanup; store.save(); changed(); }
      return fromClipboard ? { state: snapshot(), handled: result.handled } : snapshot();
    } finally { attaching.delete(id); if (retireRequested.has(id) && id !== store.state.activeConversationId) void retireEmptyConversation(id).catch(notice); }
  }
  handle('attachClipboard', id => addClipboardOrData(id, undefined, true));
  handle('attachData', (id, files) => addClipboardOrData(id, files, false));
  handle('removeAttachment', (id, attachmentId) => { const c = store.conversation(id); if (busy(c) || sending.has(id) || attaching.has(id)) throw new Error('请等待当前操作完成后移除附件'); c.attachments = c.attachments.filter(a => a.id !== attachmentId); store.save(); changed(); return snapshot(); });
  handle('send', async (id, text) => {
    const c = store.conversation(id);
    if (typeof text !== 'string' || text.length > 200_000 || (!text.trim() && !c.attachments.length)) throw new Error('请输入任务内容');
    if (sending.has(id) || attaching.has(id) || cleaningConversations.has(id) || busy(c)) throw new Error('此会话正在执行任务或添加附件');
    if (engine.state !== 'ready') throw new Error(engine.error || 'Grok 尚未连接');
    const sendEpoch = connectionEpoch;
    sending.add(id);
    try {
      await openConversation(c);
      if (c.phase !== 'ready') throw new Error(c.error || '会话未就绪');
      const attachments = [...c.attachments];
      const blocks = await promptBlocks(text, attachments, { image: c.supportsImages === true, embeddedContext: c.supportsEmbeddedContext === true });
      if (sendEpoch !== connectionEpoch || quitting) throw new Error('连接已改变，草稿已保留，请确认后再发送');
      const submitted = new Promise((resolve,reject) => pendingSends.set(id, { text, attachments, resolve, reject }));
      void adapter.prompt(id, blocks).catch(error => {
        if ([-32600, -32602].includes(error.code) && sendEpoch === connectionEpoch) {
          if (!c.draft.trim()) c.draft = text;
          const present = new Set(c.attachments.map(item => item.id));
          c.attachments.push(...attachments.filter(item => !present.has(item.id)));
        }
        const pending = pendingSends.get(id); pendingSends.delete(id);
        if (pending) pending.reject(error);
        else if (sendEpoch === connectionEpoch) { c.error = redact(error.message); notice(error); changed(); }
      }).finally(() => sending.delete(id));
      await submitted;
    } catch (error) { sending.delete(id); throw error; }
  });
  handle('cancel', id => { store.conversation(id); adapter.cancel(id); changed(false); });
  handle('setConfig', async (id, configId, value) => { const c = availableConversation(id); await openConversation(c); availableConversation(id); await adapter.setConfig(id, configId, value); });
  handle('respondPermission', (requestId, optionId) => { if (!permissions.has(requestId)) throw new Error('权限请求已结束'); adapter.respondPermission(requestId, optionId); permissions.delete(requestId); changed(false); });
  handle('terminalInput', (id, data) => { const c = store.conversation(id); if (cleaningConversations.has(id)) throw new Error('会话正在关闭'); adapter.terminalInput(id, data); if (typeof data === 'string' && !/^\x1b\[\??[\d;]*[Rcn]$/.test(data) && !/^\x1b\](?:10|11|12);rgb:/i.test(data)) { c.transient = false; delete c.pendingEmptyCleanup; changed(); } });
  handle('terminalResize', (id, cols, rows) => { store.conversation(id); adapter.terminalResize(id, cols, rows); });
  handle('terminalSnapshot', async id => { const c = availableConversation(id); await openConversation(c); availableConversation(id); return adapter.terminalSnapshot(id); });
  handle('updateSettings', patch => { store.updateSettings(patch); changed(); return snapshot(); });
  handle('engineConfig', () => readEngineConfig(adapter.environment));
  handle('saveEngineConfig', (content, revision) => saveEngineConfig(content, revision, adapter.environment));
  handle('openEngineConfig', async () => { const file = await ensureEngineConfig(adapter.environment); const error = await shell.openPath(file); if (error) throw new Error(error); });
  handle('account', () => adapter.account());
  handle('webMount', bounds => web.mount(bounds));
  handle('webStatus', () => web.status());
  handle('webAction', (action, profileId, target) => web.action(action, profileId, target));
  handle('webSend', (text, files, target) => web.send(text, files, target));
  handle('webSetup', () => web.setup());
  handle('authStatus', () => auth.info());
  handle('authStart', () => {
    if (store.state.conversations.some(busy) || sending.size || openingConversations.size || cleaningConversations.size || reconnecting) throw new Error('请先等待所有任务完成或停止，再切换 Build 账号。');
    return auth.start();
  });
  handle('authCancel', () => auth.cancel());
  handle('authExternal', () => auth.openExternal());
  handle('authSubmitCode', async code => { await auth.submitCode(code); return auth.status(); });
  handle('previewFiles', id => previewFiles(store.conversation(id)));
  handle('readPreview', (id, filename) => readPreview(store.conversation(id), filename, store.dataDir));
  handle('reconnect', async () => {
    if (cleaningConversations.size) throw new Error('正在核实并清理空任务，请稍后重新连接。');
    if (store.state.conversations.some(busy)) {
      const answer = await dialog.showMessageBox(win, { type: 'question', message: '重新连接会停止当前正在执行的任务。', buttons: ['取消','停止并重新连接'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return;
    }
    await connect();
  });
  handle('usage', async id => { await openConversation(availableConversation(id)); availableConversation(id); return adapter.usage(id); });
  handle('openFolder', async id => { const c = store.conversation(id); const error = await shell.openPath(normalizeDirectory(c.cwd)); if (error) throw new Error(error); });
  handle('openExternal', async url => { const parsed = new URL(url); if (!['https:','http:'].includes(parsed.protocol)) throw new Error('仅支持网页链接'); await shell.openExternal(parsed.toString()); });
  handle('exportConversation', async id => {
    const c = store.conversation(id);
    const result = await dialog.showSaveDialog(win, { title: '导出对话', defaultPath: c.title.replace(/[<>:"/\\|?*]/g,'-') + '.md', filters: [{ name:'Markdown', extensions:['md'] },{ name:'JSON', extensions:['json'] }] });
    if (result.canceled || !result.filePath) return;
    const content = path.extname(result.filePath).toLowerCase() === '.json' ? JSON.stringify(c, null, 2) : `# ${c.title}\n\n${c.messages.map(m => `## ${m.title || m.role}\n\n${m.content}`).join('\n\n')}`;
    await fs.promises.writeFile(result.filePath, content, 'utf8');
  });
  handle('window', action => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); else throw new Error('Unknown window action'); });
}

if (!singleInstance) app.quit();
else {
  const showMainWindow = () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
  app.on('second-instance', showMainWindow);
  app.on('activate', showMainWindow);
  app.whenReady().then(async () => {
    await initializeDesktopEnvironment();
    const menu = desktopMenuTemplate(process.platform);
    Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu) : null);
    app.setAboutPanelOptions({ applicationName: 'GrokDesk', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 GrokDesk contributors', credits: 'Independent Grok Build client. ZCode components: Apache-2.0.' });
    const documentsDir = dataArgument >= 0 ? path.join(app.getPath('userData'),'Documents') : path.join(app.getPath('documents'),'GrokDesk');
    store = new DeskStore(app.getPath('userData'), documentsDir);
    adapter = new GrokAdapter({ emit: value => { try { onAdapterEvent(value); } catch (error) { notice(error); } } });
    registerIpc();
    win = new BrowserWindow({ ...desktopWindowOptions(process.platform, app.isPackaged ? process.resourcesPath : root),
      webPreferences: { preload: path.join(root,'electron','preload.cjs'), additionalArguments: [`--grokdesk-version=${app.getVersion()}`], contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webSecurity: true },
    });
    web = createGrokWeb({ window: win, emit: event });
    auth = createGrokAuth({ getAdapter: () => adapter, getWindow: () => win, emit: event, onAuthenticated: async () => { await connect(); if (engine.state !== 'ready') throw new Error(engine.error || 'Grok 未连接'); } });
    win.webContents.setWindowOpenHandler(({url}) => { try { const p = new URL(url); if (['https:','http:'].includes(p.protocol)) void shell.openExternal(url); } catch {} return { action:'deny' }; });
    win.webContents.on('will-navigate', (e,url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback) => callback(false));
    win.on('ready-to-show', () => win.show());
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      // Closing a macOS window leaves its sessions alive; Dock/Window restores it.
      if (process.platform === 'darwin') win.hide();
      else app.quit();
    });
    if (!app.isPackaged && process.env.GROKDESK_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(process.env.GROKDESK_DEV_URL);
    else await win.loadFile(path.join(root,'renderer-dist','index.html'));
    if (store.warning) notice(store.warning);
    void connect().catch(notice);
  }).catch(error => { dialog.showErrorBox('GrokDesk 无法启动', redact(error.stack || error.message)); app.exit(1); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', e => {
    if (quitting) return;
    e.preventDefault();
    if (confirmingQuit) return;
    confirmingQuit = true;
    void (async () => {
      if (store?.state.conversations.some(busy) && win && !win.isDestroyed()) {
        showMainWindow();
        const result = await dialog.showMessageBox(win, { type:'question', message:'任务仍在运行，退出会停止当前任务。', buttons:['继续工作','停止并退出'], defaultId:0, cancelId:0 });
        if (result.response !== 1) { confirmingQuit = false; return; }
      }
      quitting = true;
      clearTimeout(stateTimer); clearTimeout(saveTimer);
      web?.dispose();
      // Persist cleanup markers before disconnecting. Native records are retried at
      // the next successful connection if shutdown or an offline engine interrupts.
      if (store) for (const c of store.state.conversations) if (canRetire(c)) { c.pendingEmptyCleanup = true; if (store.state.activeConversationId === c.id) store.state.activeConversationId = null; }
      try { store?.save(); } catch {}
      try { await auth?.dispose(); if (store) for (const c of [...store.state.conversations]) if (c.pendingEmptyCleanup) await cleanEmptyConversation(c); try { store?.save(); } catch {} await adapter?.dispose(); }
      finally { app.quit(); }
    })().catch(error => { confirmingQuit = false; notice(error); });
  });
}
