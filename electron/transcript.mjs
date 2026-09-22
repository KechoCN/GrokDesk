import { randomUUID } from 'node:crypto';

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(textOf).filter(Boolean).join('\n') : content?.type === 'text' ? content.text || '' : content?.type === 'content' ? textOf(content.content) : content?.type === 'diff' ? `${content.path || ''}\n${content.newText || ''}` : '';
const stringify = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
const diffPaths = content => Array.isArray(content) ? content.flatMap(diffPaths) : content?.type === 'content' ? diffPaths(content.content) : content?.type === 'diff' && typeof content.path === 'string' ? [{ path: content.path }] : [];
export function message(role, content, extra = {}) { return { id: randomUUID(), role, content, createdAt: new Date().toISOString(), ...extra }; }

/** Apply only protocol transcript events. Tool output remains inert text. */
export function applyUpdate(conversation, update, context) {
  const kind = update.sessionUpdate;
  if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    const text = textOf(update.content);
    if (!text) return false;
    const role = kind === 'user_message_chunk' ? 'user' : kind === 'agent_thought_chunk' ? 'thought' : 'assistant';
    if (role === 'user' && context.suppressUserEcho) return false;
    if (role !== 'user') context.suppressUserEcho = false;
    const last = conversation.messages.at(-1);
    if (last?.role === role && context.chunkMessageId === last.id) last.content += text;
    else { const item = message(role, text); conversation.messages.push(item); context.chunkMessageId = item.id; }
    return true;
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    context.chunkMessageId = null;
    let item = conversation.messages.find(item => item.role === 'tool' && item.toolId === update.toolCallId);
    if (!item) { item = message('tool', '', { toolId: update.toolCallId }); conversation.messages.push(item); }
    if (update.title) item.title = update.title;
    if (update.status) item.status = update.status;
    // Keep protocol metadata separate from inert tool text. The work panel uses
    // this evidence instead of guessing file writes or task completion from prose.
    if (typeof update.kind === 'string') item.toolKind = update.kind;
    if (Array.isArray(update.locations)) item.locations = update.locations.filter(location => typeof location?.path === 'string').map(location => ({ path: location.path, ...(Number.isInteger(location.line) ? { line: location.line } : {}) }));
    const artifacts = diffPaths(update.content);
    if (artifacts.length) item.artifacts = [...new Map([...(item.artifacts || []), ...artifacts].map(file => [file.path, file])).values()];
    const content = textOf(update.content);
    if (content) item.content = content;
    else if (update.rawOutput !== undefined) item.content = stringify(update.rawOutput);
    else if (!item.content && update.rawInput !== undefined) item.content = stringify(update.rawInput);
    return true;
  }
  if (kind === 'turn_completed') { context.chunkMessageId = null; context.suppressUserEcho = false; }
  if (kind === 'plan' && Array.isArray(update.entries)) {
    const planEntries = update.entries.filter(item => item && typeof item.content === 'string').map(item => ({ content: item.content, status: ['pending', 'in_progress', 'completed'].includes(item.status) ? item.status : 'pending' }));
    const value = planEntries.map(item => `[${item.status}] ${item.content}`).join('\n');
    const last = conversation.messages.at(-1);
    if (last?.role === 'system' && last.title === '计划') { last.content = value; last.planEntries = planEntries; }
    else conversation.messages.push(message('system', value, { title: '计划', planEntries }));
    context.chunkMessageId = null; return true;
  }
  return false;
}
