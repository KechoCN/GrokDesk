import type { Conversation, Message } from '../shared/api';

export type WorkTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export interface WorkTask { id: string; content: string; status: WorkTaskStatus; }
export interface WorkFile { id: string; name: string; path: string; }
export interface WorkReference { id: string; name: string; path?: string; url?: string; kind: 'file' | 'attachment' | 'web'; }

function statusOf(status?: string): WorkTaskStatus {
  return status === 'completed' || status === 'in_progress' || status === 'failed' || status === 'cancelled' ? status : 'pending';
}
const basename = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) || value;
const pathKey = (value: string) => /^[a-z]:[\\/]|^\\\\/i.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value;

/** Resolve a displayed protocol path; the main process still enforces preview access. */
export function workFilePath(value: string, cwd: string): string | null {
  if (!value || value.includes('\0') || value.includes('\n')) return null;
  let file = value;
  if (/^file:\/\//i.test(file)) {
    try {
      const url = new URL(file);
      if (url.hostname && url.hostname !== 'localhost') return null;
      file = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(file)) file = file.slice(1);
    } catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file)) return null;
  if (/^[a-z]:[\\/]|^[/\\]/i.test(file)) return file;
  if (!cwd) return null;
  const separator = cwd.includes('\\') ? '\\' : '/';
  return `${cwd.replace(/[\\/]$/, '')}${separator}${file.replace(/^\.\//, '').replace(/[\\/]/g, separator)}`;
}

function planFor(message: Message): WorkTask[] | null {
  if (Array.isArray(message.planEntries)) return message.planEntries.filter(item => item.content.trim()).map((item, index) => ({ id: `${message.id}-${index}`, content: item.content, status: statusOf(item.status) }));
  // Older saved transcripts contain the same protocol plan as formatted text.
  if (message.role !== 'system' || (message.title !== '计划' && message.title !== 'Plan')) return null;
  return message.content.split('\n').flatMap((line, index) => {
    const match = /^\[(pending|in_progress|completed)\]\s*(.+)$/.exec(line);
    return match ? [{ id: `${message.id}-${index}`, content: match[2], status: statusOf(match[1]) }] : [];
  });
}

export function deriveWorkPanel(conversation: Conversation) {
  const messages = conversation.messages;
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { lastUser = index; break; }
  const currentTurn = messages.slice(lastUser + 1);
  let plan: WorkTask[] | null = null;
  for (const item of currentTurn) { const next = planFor(item); if (next !== null) plan = next; }
  const tasks = plan ?? currentTurn.filter(item => item.role === 'tool').map(item => ({ id: item.id, content: item.title || item.toolKind || 'Grok', status: statusOf(item.status) }));
  const files = new Map<string, WorkFile>();
  const references = new Map<string, WorkReference>();
  function addReference(path: string, name: string | undefined, kind: 'file' | 'attachment') {
    const fullPath = workFilePath(path, conversation.cwd);
    if (!fullPath) return;
    const id = pathKey(fullPath);
    references.set(id, { id, name: name || basename(fullPath), path: fullPath, kind });
  }
  for (const item of messages) {
    for (const attachment of item.attachments || []) addReference(attachment.path, attachment.name, 'attachment');
    if (item.role === 'tool' && item.status === 'completed') {
      const outputs = [...(item.artifacts || []), ...(item.toolKind === 'edit' ? item.locations || [] : [])];
      for (const file of outputs) {
        const fullPath = workFilePath(file.path, conversation.cwd);
        if (!fullPath) continue;
        const id = pathKey(fullPath);
        files.set(id, { id, name: 'name' in file && file.name ? String(file.name) : basename(fullPath), path: fullPath });
      }
      if (item.toolKind === 'read' || item.toolKind === 'search') for (const file of item.locations || []) addReference(file.path, undefined, 'file');
    }
    if (item.role === 'assistant') {
      // Only explicit links are references. Plain tool output and instructions in
      // attached files cannot manufacture task states, file writes, or actions.
      for (const match of item.content.matchAll(/\[([^\]\n]+)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[2].replace(/^<|>$/g, '');
        if (/^https?:\/\//i.test(target)) {
          try { const url = new URL(target).href; references.set(url, { id: url, name: match[1], url, kind: 'web' }); } catch { /* Incomplete streamed link. */ }
        } else if (/^(?:file:\/\/|[a-z]:[\\/]|[./\\])/.test(target)) addReference(target.replace(/:\d+(?::\d+)?$/, ''), match[1], 'file');
      }
    }
  }
  for (const id of files.keys()) if (references.get(id)?.kind !== 'attachment') references.delete(id);
  const active = ['connecting', 'running', 'waiting', 'cancelling'].includes(conversation.phase);
  return {
    visible: active || messages.some(item => item.role === 'assistant' || item.role === 'thought' || item.role === 'tool' || planFor(item) !== null),
    active, tasks, hasPlan: plan !== null, completed: tasks.filter(item => item.status === 'completed').length,
    artifacts: [...files.values()], references: [...references.values()],
  };
}

export interface WorkPanelPreferences { collapsed: boolean; tasks: boolean; artifacts: boolean; references: boolean; }
export const defaultWorkPanelPreferences: WorkPanelPreferences = { collapsed: false, tasks: true, artifacts: true, references: true };
export function readWorkPanelPreferences(storage: Pick<Storage, 'getItem'>, conversationId: string): WorkPanelPreferences {
  try {
    const value = JSON.parse(storage.getItem(`grokdesk-work-panel:${conversationId}`) || 'null');
    return Object.fromEntries(Object.entries(defaultWorkPanelPreferences).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as unknown as WorkPanelPreferences;
  } catch { return { ...defaultWorkPanelPreferences }; }
}
