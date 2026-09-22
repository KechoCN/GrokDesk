const { contextBridge } = require('electron');
const listeners = new Set();
const calls = [];
let nativeClipboard = false;
let clipboardBehavior = 'normal';
const pendingClipboard = [];
let revision = 1;
let terminalSequence = 0;
let contextFailure = false;
let state = {
  version: revision, settings: { theme: 'system', language: 'zh-CN', fontSize: 14, sendKey: 'enter', enginePath: '', terminalVisible: false, copyOnSelect: true },
  workspaces: [{ id: 'project', name: 'GrokDesk', path: 'D:\\Example', pinned: false, archived: false }],
  conversations: [{ id: 'conversation', title: '新任务', workspaceId: 'project', cwd: 'D:\\Example', pinned: false, archived: false, updatedAt: new Date().toISOString(), draft: '', attachments: [], messages: [], phase: 'ready', models: [], configOptions: [], availableCommands: [{ name: 'review', description: 'Review the current changes' }] }],
  activeConversationId: 'conversation', engine: { state: 'ready', auth: 'inherited', version: 'test' }, permissions: [],
};
const clone = value => JSON.parse(JSON.stringify(value));
const changed = () => { state.version = ++revision; for (const listener of listeners) listener({ type: 'state', state: clone(state) }); return clone(state); };
const webState = { profiles: [], activeProfileId: '', url: 'https://grok.com/', title: 'Grok', loading: false, visible: false, canGoBack: false, canGoForward: false, connection: 'disconnected', messages: [], history: [], capabilities: { send:false, stop:false, attachments:false } };
const api = {
  platform: process.argv.find(value => value.startsWith('--grokdesk-test-platform='))?.split('=')[1] || process.platform,
  version: '0.1.0',
  bootstrap: async () => clone(state),
  webStatus: async () => clone(webState),
  webMount: async bounds => { calls.push({ name: 'webMount', ...bounds }); return clone(webState); },
  webAction: async (action, target) => { calls.push({ name:'webAction', action, target }); return clone(webState); },
  webSetup: async () => { calls.push({ name:'webSetup' }); webState.setupPath = 'D:\\Fixture\\browser-extension'; for (const listener of listeners) listener({ type:'web', state:clone(webState) }); return clone(webState); },
  webSend: async (text, files = []) => { calls.push({ name:'webSend', text, files:files.map(file => ({ name:file.name, size:file.data.length })) }); return clone(webState); },
  updateSettings: async patch => { Object.assign(state.settings, patch); return changed(); },
  updateConversation: async (id, patch) => { Object.assign(state.conversations.find(c => c.id === id), patch); return changed(); },
  setConversationWorkspace: async (id, workspaceId) => { calls.push({ name: 'setConversationWorkspace', id, workspaceId }); const c = state.conversations.find(c => c.id === id); if (['running', 'connecting', 'waiting', 'cancelling'].includes(c.phase)) throw new Error('请等待当前任务完成'); c.workspaceId = workspaceId; c.cwd = state.workspaces.find(w => w.id === workspaceId)?.path ?? 'D:\\Scratch'; return changed(); },
  contextCatalog: async (id, kind, query) => { calls.push({ name: 'contextCatalog', id, kind, query }); if (contextFailure) throw new Error('扩展目录暂时不可用'); return { items: (kind === 'mention' ? [
    { id: 'file-readme', kind: 'file', name: 'README.md', description: 'Project document', path: 'D:\\Example\\README.md' },
  ] : [
    { id: 'skill-example', kind: 'skill', name: 'example-skill', description: 'An installed test skill', path: 'D:\\Skills\\example\\SKILL.md', insertText: '/example-skill ' },
    { id: 'plugin-example', kind: 'plugin', name: 'example-plugin', description: 'An installed test plugin', insertText: 'Use the example-plugin plugin. ' },
  ]).filter(item => item.name.toLowerCase().includes(query.toLowerCase())), truncated: false }; },
  attachFiles: async (id, paths) => { calls.push({ name: 'attachFiles', id, paths }); const c = state.conversations.find(c => c.id === id); c.attachments.push(...paths.map((file, index) => ({ id: String(c.attachments.length + index), name: file.split(/[\\/]/).at(-1), path: file, size: 100, kind: 'text', mime: 'text/plain' }))); return changed(); },
  attachClipboard: async id => {
    calls.push({ name: 'attachClipboard', id });
    if (clipboardBehavior === 'reject') throw new Error('Native clipboard provider unavailable (fixture)');
    if (clipboardBehavior === 'hang') await new Promise(resolve => pendingClipboard.push(resolve));
    return { state: clone(state), handled: nativeClipboard };
  },
  attachData: async (id, files) => { calls.push({ name: 'attachData', id, files: files.map(file => ({ name: file.name, mime: file.mime, size: file.data.length })) }); const c = state.conversations.find(c => c.id === id); c.attachments.push(...files.map((file, index) => ({ id: `memory-${c.attachments.length + index}`, name: file.name, path: 'D:\\Snapshot\\' + file.name, size: file.data.length, kind: file.mime.startsWith('image/') ? 'image' : 'binary', mime: file.mime }))); return changed(); },
  getFilePath: file => file.name === 'clipboard-image.png' ? '' : 'D:\\Example\\' + file.name,
  removeAttachment: async (id, attachmentId) => { const c = state.conversations.find(c => c.id === id); c.attachments = c.attachments.filter(a => a.id !== attachmentId); return changed(); },
  chooseAttachments: async id => { calls.push({ name: 'chooseAttachments', id }); return changed(); },
  account: async () => ({ state: 'ready', source: 'grok-cloud', checkedAt: new Date().toISOString(), subscriptionTier: 'Test plan', usedPercent: 28, remainingPercent: 72, periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', periodType: 'monthly' }),
  authStatus: async () => ({ state: 'idle' }),
  previewFiles: async () => ({ files: [{ path: 'README.md', name: 'README.md', size: 30 }, { path: 'image.png', name: 'image.png', size: 20 }] }),
  readPreview: async (_id, file) => file === 'image.png' ? { path: file, name: file, kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBxoAAAAASUVORK5CYII=', size: 20 } : { path: file, name: file, kind: 'text', content: '# Preview fixture\nSelectable preview text', size: 40 },
  engineConfig: async () => ({ path: 'D:\\Fixture\\config.toml', content: 'model = "fixture"\n', revision: 'fixture', exists: true }),
  saveEngineConfig: async content => ({ path: 'D:\\Fixture\\config.toml', content, revision: 'next', exists: true }),
  openEngineConfig: async () => {},
  addWorkspace: async () => { calls.push({ name: 'addWorkspace' }); return changed(); },
  newConversation: async () => changed(),
  selectConversation: async id => { state.activeConversationId = id; return changed(); },
  closeConversation: async () => changed(),
  readClipboard: async () => '', writeClipboard: async text => { calls.push({ name: 'writeClipboard', text }); },
  terminalSnapshot: async () => ({ data: '', sequence: 0 }), terminalResize: async () => {}, terminalInput: async () => {},
  send: async (id, text) => { calls.push({ name: 'send', text }); },
  openExternal: async () => {}, openFolder: async () => {}, setConfig: async () => {}, window: async () => {},
  onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
};
let firstComposerFonts = null;
if (api.platform === 'linux') {
  const observer = new MutationObserver(() => {
    if (!document.querySelector('textarea.composer-text')) return;
    firstComposerFonts = [...document.fonts].filter(font => font.family.replaceAll(/['"]/g, '') === 'GrokDesk Noto Sans SC').map(font => font.status);
    observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}
api.firstComposerFonts = () => clone(firstComposerFonts);
contextBridge.exposeInMainWorld('grokdesk', api);
contextBridge.exposeInMainWorld('grokdeskTest', { calls: () => clone(calls), state: () => clone(state), nativeClipboard: value => { nativeClipboard = value; }, clipboardBehavior: value => { if (!['normal', 'reject', 'hang'].includes(value)) throw new Error('Invalid clipboard fixture behavior'); clipboardBehavior = value; }, pendingClipboard: () => pendingClipboard.length, releaseClipboard: () => { const pending = pendingClipboard.splice(0); for (const resolve of pending) resolve(); return pending.length; }, contextFailure: value => { contextFailure = value; }, setWorkspaces: value => { state.workspaces = value; changed(); }, setConversations: (value, activeId) => { state.conversations = value; state.activeConversationId = activeId; changed(); }, setWeb: value => { Object.assign(webState, value); for (const listener of listeners) listener({ type:'web', state:clone(webState) }); }, setPhase: value => { state.conversations[0].phase = value; changed(); }, emitTerminal: data => { for (const listener of listeners) listener({ type: 'terminal', conversationId: 'conversation', sequence: ++terminalSequence, data }); } });
