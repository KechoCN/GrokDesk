import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sameDirectory } from './platform.mjs';

export const defaults = Object.freeze({ theme: 'system', language: 'zh-CN', fontSize: 14, sendKey: 'enter', enginePath: '', terminalVisible: false, copyOnSelect: true });
// Only tasks explicitly created by this version are eligible. An imported or
// older empty transcript can still have history waiting to be replayed by Grok.
export function isDisposableConversation(c) {
  return c?.transient === true && !c.messages.length && !c.attachments.length && !c.draft?.trim()
    && !c.pinned && !c.archived && !c.manualTitle
    && !['running', 'waiting', 'cancelling', 'connecting'].includes(c.phase);
}
const initial = () => ({ version: 1, settings: { ...defaults }, workspaces: [], conversations: [], activeConversationId: null });
export function inside(root, file) { const relative = path.relative(path.resolve(root), path.resolve(file)); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
export function normalizeDirectory(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('工作目录无效');
  const result = fs.realpathSync.native(path.resolve(value));
  if (!fs.statSync(result).isDirectory()) throw new Error('工作目录不存在，请重新选择文件夹');
  return result;
}
function validateState(state) {
  return state?.version === 1 && state.settings && Array.isArray(state.workspaces) && Array.isArray(state.conversations)
    && state.conversations.every(c => typeof c.id === 'string' && typeof c.cwd === 'string' && Array.isArray(c.messages) && Array.isArray(c.attachments));
}
export class DeskStore {
  constructor(dataDir, documentsDir) {
    this.dataDir = path.resolve(dataDir);
    this.documentsDir = path.resolve(documentsDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.file = path.join(this.dataDir, 'desktop-state.json');
    this.warning = null;
    this.state = initial();
    if (fs.existsSync(this.file)) {
      try { this.state = this.read(this.file); }
      catch {
        const preserved = this.file + '.corrupt-' + Date.now();
        fs.copyFileSync(this.file, preserved);
        try { this.state = this.read(this.file + '.bak'); this.warning = '已从备份恢复历史；损坏文件已另存保留。'; }
        catch { this.warning = '历史文件无法读取，原文件已保留。请查看数据目录中的 .corrupt 文件。'; }
      }
    }
    this.state.settings = { ...defaults, ...this.state.settings };
    for (const c of this.state.conversations) {
      if (['running', 'waiting', 'cancelling'].includes(c.phase)) c.transient = false;
      c.phase = 'ready'; c.models ??= []; c.configOptions ??= []; c.draft ??= '';
      delete c.error;
      if (isDisposableConversation(c)) c.pendingEmptyCleanup = true;
      else delete c.pendingEmptyCleanup;
    }
    this.state.conversations = this.state.conversations.filter(c => !c.pendingEmptyCleanup || c.engineSessionId);
    if (!this.state.conversations.some(c => c.id === this.state.activeConversationId && !c.pendingEmptyCleanup)) this.state.activeConversationId = null;
  }
  read(file) { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!validateState(data)) throw new Error('Invalid state format'); return data; }
  save() {
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    const json = JSON.stringify(this.state, null, 2);
    try {
      fs.writeFileSync(temporary, json, { encoding: 'utf8', flag: 'wx' });
      if (fs.existsSync(this.file)) {
        try { this.read(this.file); fs.copyFileSync(this.file, this.file + '.bak'); } catch { /* Keep the last valid backup. */ }
      }
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  conversation(id) { const c = this.state.conversations.find(c => c.id === id); if (!c) throw new Error('对话不存在'); return c; }
  workspace(id) { const w = this.state.workspaces.find(w => w.id === id); if (!w) throw new Error('工作区不存在'); return w; }
  addWorkspace(directory, name) {
    const root = normalizeDirectory(directory);
    const existing = this.state.workspaces.find(w => sameDirectory(w.path, root));
    if (existing) { existing.archived = false; this.save(); return existing; }
    const workspace = { id: randomUUID(), name: (name || path.basename(root) || root).slice(0, 100), path: root, pinned: false, archived: false };
    this.state.workspaces.push(workspace); this.save(); return workspace;
  }
  newConversation(workspaceId = null, { persist = true } = {}) {
    const id = randomUUID();
    let cwd;
    if (workspaceId) cwd = normalizeDirectory(this.workspace(workspaceId).path);
    else { cwd = path.join(this.documentsDir, 'Chats', new Date().toISOString().slice(0, 10), id); fs.mkdirSync(cwd, { recursive: true }); }
    const c = { id, title: '新任务', workspaceId, cwd, transient: true, pinned: false, archived: false, updatedAt: new Date().toISOString(), draft: '', attachments: [], messages: [], phase: 'ready', models: [], configOptions: [], currentModelId: null, currentEffort: null };
    this.state.conversations.unshift(c); this.state.activeConversationId = id; if (persist) this.save(); return c;
  }
  setConversationWorkspace(id, workspaceId) {
    const source = this.conversation(id);
    if (workspaceId !== null && typeof workspaceId !== 'string') throw new Error('请选择有效的项目');
    if (['running', 'waiting', 'connecting', 'cancelling'].includes(source.phase)) throw new Error('请先停止当前任务再切换项目');
    if (source.workspaceId === workspaceId) return source;
    if (workspaceId !== null) normalizeDirectory(this.workspace(workspaceId).path);
    // A connected native session owns its original working directory. Move only
    // the unsent draft to a fresh session; preserve the previous history intact.
    const previousActive = this.state.activeConversationId;
    const target = this.newConversation(workspaceId, { persist: false });
    const originalDraft = source.draft, originalAttachments = source.attachments;
    try {
      const directory = path.join(this.dataDir, 'attachments', target.id);
      target.attachments = source.attachments.map(attachment => {
        const snapshotRoot = fs.realpathSync(path.join(this.dataDir, 'attachments', source.id));
        const original = fs.realpathSync(attachment.path);
        if (!inside(snapshotRoot, original)) throw new Error('附件快照无效，请重新添加附件');
        fs.mkdirSync(directory, { recursive: true });
        const destination = path.join(directory, path.basename(original));
        fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
        return { ...attachment, path: destination };
      });
      target.draft = source.draft;
      source.draft = ''; source.attachments = [];
      this.save(); return target;
    } catch (error) {
      source.draft = originalDraft; source.attachments = originalAttachments;
      this.state.conversations = this.state.conversations.filter(c => c.id !== target.id);
      this.state.activeConversationId = previousActive;
      throw error;
    }
  }
  importSessions(sessions) {
    for (const s of sessions) {
      if (!s.sessionId || !s.cwd || this.state.conversations.some(c => c.engineSessionId === s.sessionId)) continue;
      this.state.conversations.push({ id: randomUUID(), title: s.title || 'Grok · ' + s.sessionId.slice(-8), workspaceId: null, cwd: s.cwd, engineSessionId: s.sessionId, pinned: false, archived: false, updatedAt: s.updatedAt || new Date().toISOString(), draft: '', attachments: [], messages: [], phase: 'ready', models: [], configOptions: [], currentModelId: null, currentEffort: null });
    }
    this.save();
  }
  updateConversation(id, patch, { persist = true } = {}) {
    const c = this.conversation(id);
    if (!patch || typeof patch !== 'object') throw new Error('无效的对话修改');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'title') { if (typeof value !== 'string' || !value.trim()) throw new Error('标题不能为空'); c.title = value.trim().slice(0, 150); c.manualTitle = true; }
      else if (key === 'draft') { if (typeof value !== 'string' || value.length > 200_000) throw new Error('草稿过长'); c.draft = value; }
      else if (key === 'pinned' || key === 'archived') { if (typeof value !== 'boolean') throw new Error('无效的开关值'); c[key] = value; }
      else throw new Error('不允许修改这个会话字段');
    }
    if (!isDisposableConversation(c)) delete c.pendingEmptyCleanup;
    if (persist) this.save(); return c;
  }
  deleteConversation(id) {
    const c = this.conversation(id);
    if (['running', 'waiting', 'cancelling', 'connecting'].includes(c.phase)) throw new Error('请先停止当前任务');
    this.state.conversations = this.state.conversations.filter(item => item.id !== id);
    if (this.state.activeConversationId === id) this.state.activeConversationId = null;
    this.save();
    // Cwd, attachments, original files and the engine's session records are retained.
  }
  updateSettings(patch) {
    const settings = { ...this.state.settings };
    for (const [key, value] of Object.entries(patch || {})) {
      if (key === 'theme' && ['system', 'light', 'dark', 'lagoon', 'midnight', 'forest', 'rose'].includes(value)) settings.theme = value;
      else if (key === 'language' && ['zh-CN', 'zh-TW', 'en-US'].includes(value)) settings.language = value;
      else if (key === 'sendKey' && ['enter', 'ctrl-enter'].includes(value)) settings.sendKey = value;
      else if (key === 'fontSize' && Number.isFinite(value) && value >= 12 && value <= 20) settings.fontSize = value;
      else if (key === 'enginePath' && typeof value === 'string' && value.length < 32768) settings.enginePath = value.trim();
      else if (key === 'terminalVisible' && typeof value === 'boolean') settings.terminalVisible = value;
      else if (key === 'copyOnSelect' && typeof value === 'boolean') settings.copyOnSelect = value;
      else throw new Error('设置值无效：' + key);
    }
    this.state.settings = settings; this.save(); return settings;
  }
}
