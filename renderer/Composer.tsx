// ZCode ChatPromptEditor / ConversationComposer presentation adapted under Apache-2.0.
// Upstream 872ad960de7ec172591f7e1952f7849229f94521; GrokDesk supplies IPC, drafts and attachments.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUp, Check, ChevronDown, File, LoaderCircle, Plug, Plus, Search, ShieldCheck, Sparkles, Square, Terminal, X } from 'lucide-react';
import type { AppSnapshot, ContextItem, Conversation } from '../shared/api';
import { Button } from './components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { cn } from './components/lib/utils';
import { useText } from './i18n';
import { errorMessage, type RunAction } from './useDesk';
import { completionToken, isCompositionKey, replaceCompletion } from './composer-completion';
import { ComposerContextBar } from './ComposerContextBar';
import { hasPrimaryModifier, primaryKey } from './platform';
export { ConversationDropZone } from './ConversationDropZone';

const draftFlushers = new Map<string, () => Promise<void>>();
export async function flushComposerDraft(conversationId?: string) {
  const flushers = conversationId ? [draftFlushers.get(conversationId)] : [...draftFlushers.values()];
  await Promise.all(flushers.map(flush => flush?.()));
}

export function Composer({ conversation, state, run, notify, centered = false, onToggleTerminal, terminalVisible }: { conversation: Conversation; state: AppSnapshot; run: RunAction; notify: (text: string) => void; centered?: boolean; onToggleTerminal?: () => void; terminalVisible?: boolean }) {
  const t = useText();
  const [draft, setDraft] = useState(conversation.draft);
  const [configuring, setConfiguring] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [caret, setCaret] = useState(conversation.draft.length);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextWarning, setContextWarning] = useState('');
  const [contextTruncated, setContextTruncated] = useState(false);
  const [contextPending, setContextPending] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const menuId = useId();
  const form = useRef<HTMLFormElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const draftRef = useRef(draft);
  const submitGate = useRef(false);
  const pasteGate = useRef(false);
  const contextGate = useRef(false);
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  const saveErrorShown = useRef(false);
  const isRunning = ['running', 'waiting', 'cancelling'].includes(conversation.phase) || submitting;
  const connecting = conversation.phase === 'connecting';
  const disabled = isRunning || connecting || configuring || contextPending || pasting;
  const model = conversation.models.find(m => m.id === conversation.currentModelId);
  const modelOption = conversation.configOptions.find(option => option.category === 'model' || option.id === 'model');
  const effortOption = conversation.configOptions.find(option => option.id.includes('reasoning') || option.id.includes('effort'));
  const modeOptions = conversation.configOptions.filter(option => (option.category === 'mode' || option.id === 'mode') && !/reason|effort/i.test(option.id));
  const models = modelOption?.options.map(option => ({ id: option.value, name: option.name })) ?? conversation.models;
  const efforts = effortOption?.options.map(option => ({ id: option.value, label: option.name })) ?? model?.efforts ?? [];
  const token = !disabled && !menuDismissed && !composing.current ? completionToken(draft, caret) : null;
  const query = token?.query.toLocaleLowerCase() ?? '';
  const commands: ContextItem[] = token?.kind === 'command' ? (conversation.availableCommands ?? [])
    .filter(command => `${command.name} ${command.description}`.toLocaleLowerCase().includes(query))
    .map(command => ({ id: 'command:' + command.name, kind: 'command', name: command.name, description: command.description + (command.input?.hint ? ` · ${command.input.hint}` : ''), insertText: '/' + command.name.replace(/^\//, '') + ' ' })) : [];
  const items = [...commands, ...contextItems];
  const menuOpen = token !== null;

  function saveDraft(value: string) {
    const save = window.grokdesk.updateConversation(conversation.id, { draft: value });
    pendingSave.current = save;
    void save.then(() => { if (draftRef.current === value) dirty.current = false; saveErrorShown.current = false; }).catch(error => {
      if (!saveErrorShown.current) { saveErrorShown.current = true; notify(errorMessage(error)); }
    });
    return save;
  }
  function changeDraft(value: string, position: number, dismiss = false) {
    dirty.current = true; draftRef.current = value;
    setDraft(value); setCaret(position); setMenuDismissed(dismiss); setSelectedIndex(0);
    // Persist on input, before navigation or native window close can discard an
    // unsaved composer.
    void saveDraft(value);
  }

  useEffect(() => { if (!dirty.current && !submitting) { draftRef.current = conversation.draft; setDraft(conversation.draft); } }, [conversation.draft, submitting]);
  useEffect(() => {
    draftRef.current = draft;
    if (textArea.current) { textArea.current.style.height = 'auto'; textArea.current.style.height = `${Math.min(200, Math.max(centered ? 84 : 56, textArea.current.scrollHeight))}px`; }
  }, [draft, conversation.id, centered, run]);
  useEffect(() => {
    const flush = async () => {
      if (submitGate.current) return;
      if (dirty.current) await saveDraft(draftRef.current);
      else await pendingSave.current;
    };
    draftFlushers.set(conversation.id, flush);
    return () => { draftFlushers.delete(conversation.id); if (dirty.current && !submitGate.current) void saveDraft(draftRef.current); };
  }, [conversation.id]);
  useEffect(() => {
    if (!token) { setContextItems([]); setContextLoading(false); return; }
    let cancelled = false;
    setContextLoading(true); setContextItems([]); setContextWarning(''); setContextTruncated(false); setSelectedIndex(0);
    const timer = window.setTimeout(() => {
      void window.grokdesk.contextCatalog(conversation.id, token.kind, token.query).then(result => {
        if (cancelled) return;
        setContextItems(result.items); setContextWarning(result.warning ?? ''); setContextTruncated(result.truncated);
      }).catch(error => { if (!cancelled) setContextWarning(errorMessage(error)); }).finally(() => { if (!cancelled) setContextLoading(false); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [conversation.id, token?.kind, token?.query]);
  useEffect(() => { menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const position = () => {
      const rect = form.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top - 12;
      const below = window.innerHeight - rect.bottom - 12;
      const opensAbove = above >= 180 || above >= below;
      setMenuPosition({ position: 'fixed', left: Math.max(8, rect.left), width: Math.min(rect.width, window.innerWidth - 16),
        ...(opensAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.max(96, Math.min(380, opensAbove ? above : below)) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [menuOpen, draft]);

  async function selectContext(item: ContextItem) {
    if (!token || disabled || contextGate.current) return;
    const activeToken = token;
    const previous = draftRef.current;
    contextGate.current = true; setContextPending(true);
    try {
      // Reading SKILL.md into the existing attachment pipeline guarantees the
      // selected instructions reach ACP even when slash parsing is TUI-only.
      if ((item.kind === 'file' || item.kind === 'skill') && item.path) {
        const attached = await run(window.grokdesk.attachFiles(conversation.id, [item.path]));
        if (!attached) return;
      }
      const insert = item.kind === 'file' ? `@${JSON.stringify(item.name)} ` : item.insertText ?? `/${item.name} `;
      const replacement = replaceCompletion(previous, activeToken, insert);
      changeDraft(replacement.value, replacement.caret, true);
      requestAnimationFrame(() => { textArea.current?.focus(); textArea.current?.setSelectionRange(replacement.caret, replacement.caret); });
    } catch (error) { notify(errorMessage(error)); }
    finally { contextGate.current = false; setContextPending(false); }
  }

  async function selectExtension(item: ContextItem) {
    if (disabled || contextGate.current || submitGate.current || pasteGate.current) return false;
    contextGate.current = true; setContextPending(true);
    try {
      if (item.kind === 'skill' && item.path && !conversation.attachments.some(file => file.sourcePath === item.path || file.path === item.path)) {
        const attached = await run(window.grokdesk.attachFiles(conversation.id, [item.path]));
        if (!attached) return false;
      }
      const current = draftRef.current;
      const insertion = item.insertText ?? `/${item.name} `;
      if (!current.includes(insertion)) {
        // Append without replacing the user's selection or unfinished slash token.
        const value = current + (current && !/\s$/.test(current) ? '\n' : '') + insertion;
        changeDraft(value, value.length, true);
        requestAnimationFrame(() => { textArea.current?.focus(); textArea.current?.setSelectionRange(value.length, value.length); });
      }
      return true;
    } catch (error) { notify(errorMessage(error)); return false; }
    finally { contextGate.current = false; setContextPending(false); }
  }

  async function changeWorkspace(workspaceId: string | null) {
    if (disabled || contextGate.current || submitGate.current || pasteGate.current) return false;
    if (workspaceId === conversation.workspaceId) return true;
    contextGate.current = true; setContextPending(true);
    try {
      await flushComposerDraft(conversation.id);
      return Boolean(await run(window.grokdesk.setConversationWorkspace(conversation.id, workspaceId)));
    } catch (error) { notify(errorMessage(error)); return false; }
    finally { contextGate.current = false; setContextPending(false); }
  }

  async function addWorkspace() {
    if (disabled || contextGate.current || submitGate.current || pasteGate.current) return false;
    contextGate.current = true; setContextPending(true);
    try {
      await flushComposerDraft(conversation.id);
      const previousIds = new Set(state.workspaces.map(item => item.id));
      const next = await run(window.grokdesk.addWorkspace());
      const added = next?.workspaces.find(item => item.id === next.selectedWorkspaceId) || next?.workspaces.find(item => !previousIds.has(item.id));
      if (!added) return false;
      return Boolean(await run(window.grokdesk.setConversationWorkspace(conversation.id, added.id)));
    } catch (error) { notify(errorMessage(error)); return false; }
    finally { contextGate.current = false; setContextPending(false); }
  }

  async function submit() {
    if (submitGate.current || pasteGate.current || contextGate.current || disabled || state.engine.state !== 'ready' || (!draft.trim() && !conversation.attachments.length)) return;
    submitGate.current = true;
    setSubmitting(true);
    try {
      await window.grokdesk.updateConversation(conversation.id, { draft });
      // The saved draft is now durable. Do not let an unmount or old debounce timer
      // write it back after the backend atomically acknowledges this submission.
      dirty.current = false;
      await window.grokdesk.send(conversation.id, draft.trim());
      dirty.current = false;
      draftRef.current = '';
      setDraft('');
    } catch (error) { dirty.current = true; notify(errorMessage(error)); }
    finally { setSubmitting(false); submitGate.current = false; }
  }

  async function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    if (event.currentTarget.readOnly || submitGate.current || pasteGate.current || contextGate.current) return;
    // Capture synchronously: Chromium only exposes clipboard files during paste.
    const files = Array.from(event.clipboardData.files);
    // Match textarea's native newline normalization before calculating the caret.
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd;
    const fileFormats = Array.from(event.clipboardData.types).some(type => /^(Files|CF_HDROP|FileNameW?|Shell IDList Array|Preferred DropEffect|application\/x-moz-file)$/i.test(type))
      || event.clipboardData.getData('text/uri-list').split(/\r?\n/).some(line => /^file:/i.test(line));
    function insertText() {
      const current = draftRef.current, next = current.slice(0, start) + text + current.slice(end);
      changeDraft(next, start + text.length, true);
      requestAnimationFrame(() => textArea.current?.setSelectionRange(start + text.length, start + text.length));
    }
    // Ordinary text is available now. Do not send it through asynchronous file
    // probing, which can fail, stall, or mistake a rich-text preview for a file.
    if (text && !files.length && !fileFormats) { insertText(); return; }
    if (disabled) return;
    pasteGate.current = true; setPasting(true);
    try {
      const sourcePaths = files.map(file => window.grokdesk.getFilePath(file));
      if (files.length && sourcePaths.every(Boolean)) {
        await run(window.grokdesk.attachFiles(conversation.id, sourcePaths));
        return;
      }
      try {
        const native = await window.grokdesk.attachClipboard(conversation.id);
        await run(Promise.resolve(native.state));
        if (native.handled) return;
      } catch (error) {
        // Browser clipboard blobs are still usable if the native clipboard
        // provider is unavailable. Never discard those captured file bytes.
        if (!files.length) {
          if (text) { insertText(); return; }
          throw error;
        }
      }
      if (files.length) {
        if (files.length + conversation.attachments.length > 12 || files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('每次最多 12 个附件，单个文件不得超过 20 MB。');
        const paths: string[] = [], memory: { name: string; mime: string; data: Uint8Array }[] = [];
        for (const file of files) {
          const source = window.grokdesk.getFilePath(file);
          if (source) paths.push(source);
          else memory.push({ name: file.name || '剪贴板图片.png', mime: file.type, data: new Uint8Array(await file.arrayBuffer()) });
        }
        if (paths.length) await run(window.grokdesk.attachFiles(conversation.id, paths));
        if (memory.length) await run(window.grokdesk.attachData(conversation.id, memory));
        return;
      }
      if (text) insertText();
    } catch (error) { notify(errorMessage(error)); }
    finally { pasteGate.current = false; setPasting(false); textArea.current?.focus(); }
  }

  async function config(id: string, value: string) {
    setConfiguring(true);
    try { await window.grokdesk.setConfig(conversation.id, id, value); }
    catch (error) { notify(errorMessage(error)); }
    finally { setConfiguring(false); }
  }

  return <div className={cn('chat-composer-region z-20 w-full shrink-0', centered && 'max-w-2xl')}>
    {conversation.error && <div role="alert" className="mb-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui-sm text-destructive">{conversation.error}</div>}
    <div className={cn('chat-composer-input-surface relative z-10 w-full', centered && 'rounded-2xl shadow-xl/5')}>
      <form ref={form} onSubmit={event => { event.preventDefault(); void submit(); }} className="relative">
        {menuOpen && createPortal(<div style={menuPosition} className="z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-ui-xs text-foreground-subtle"><Search className="size-3.5" /><span>{token.kind === 'mention' ? '文件、技能与插件' : '命令、技能与插件'}</span><span className="ml-auto">↑↓ · Enter / Tab · Esc</span></div>
          <div ref={menu} id={menuId} role="listbox" aria-label={token.kind === 'mention' ? '添加上下文' : '命令与扩展'} className="min-h-0 overflow-y-auto p-1">
            {items.map((item, index) => { const Icon = item.kind === 'file' ? File : item.kind === 'skill' ? Sparkles : item.kind === 'plugin' ? Plug : Terminal; return <button key={item.id} id={`${menuId}-${index}`} role="option" aria-selected={index === selectedIndex} type="button" className={cn('flex w-full min-w-0 items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors', index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60')} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelectedIndex(index)} onClick={() => void selectContext(item)}>
              <Icon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" /><span className="min-w-0 flex-1"><span className="block truncate text-ui-sm font-medium">{item.kind === 'command' || item.kind === 'skill' ? '/' : ''}{item.name}</span>{item.description && <span className="mt-0.5 line-clamp-2 block text-ui-xs text-foreground-subtle">{item.description}</span>}</span><span className="shrink-0 text-ui-xs text-foreground-subtlest">{item.kind === 'file' ? '文件' : item.kind === 'skill' ? '技能' : item.kind === 'plugin' ? '插件' : '命令'}</span>
            </button>; })}
            {contextLoading && <div role="status" className="flex items-center gap-2 px-3 py-3 text-ui-sm text-foreground-subtle"><LoaderCircle className="size-3.5 animate-spin" />{t('loading')}</div>}
            {!contextLoading && !items.length && <div className="px-3 py-4 text-ui-sm text-foreground-subtle">没有匹配项。{token.kind === 'mention' ? '可使用附件按钮选择其他文件。' : '当前引擎尚未提供可用命令或扩展。'}</div>}
          </div>
          {(contextWarning || contextTruncated) && <div className="border-t border-border px-3 py-2 text-ui-xs text-foreground-subtle">{contextWarning || '结果较多，请输入名称继续搜索。'}</div>}
        </div>, document.body)}
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-input-border bg-input p-3 transition-colors hover:border-input-border-hover focus-within:!border-input-border-focused focus-within:bg-input-focused">
          {conversation.attachments.length > 0 && <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {conversation.attachments.map(file => <div key={file.id} className="relative flex h-12 max-w-60 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface p-1.5 pr-7" title={`${file.path}\n${t('attachNote')} · ${file.mime}`}>
              {file.preview ? <img src={file.preview} alt="" className="size-8 shrink-0 rounded-md object-cover" /> : <File className="mx-1 size-5 shrink-0 text-foreground-subtle" />}
              <div className="min-w-0"><div className="truncate text-ui-sm">{file.name}</div><div className="text-ui-xs text-foreground-subtlest">{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</div></div>
              <Button variant="ghost" size="icon-xs" type="button" className="absolute right-1 top-1" disabled={disabled} title={t('remove')} aria-label={`${t('remove')} ${file.name}`} onClick={() => void run(window.grokdesk.removeAttachment(conversation.id, file.id))}><X className="size-3" /></Button>
            </div>)}
          </div>}
          {conversation.supportsImages === false && conversation.attachments.some(file => file.kind === 'image') && <p className="flex items-start gap-2 text-ui-sm text-warning"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{t('imagesUnsupported')}</p>}
          <textarea ref={textArea} aria-label={t('placeholder')} aria-autocomplete="list" aria-controls={menuOpen ? menuId : undefined} aria-expanded={menuOpen} aria-activedescendant={menuOpen && items[selectedIndex] ? `${menuId}-${selectedIndex}` : undefined} className="composer-text w-full resize-none bg-transparent px-0.5 text-ui-base leading-6 text-foreground outline-none placeholder:text-foreground-subtlest" value={draft} readOnly={isRunning || contextPending || pasting} placeholder={t(centered ? 'placeholder' : 'followup')}
            onPaste={event => void paste(event)}
            onChange={event => changeDraft(event.target.value, event.target.selectionStart)}
            onSelect={event => setCaret(event.currentTarget.selectionStart)}
            onBlur={() => setMenuDismissed(true)}
            onCompositionStart={() => { composing.current = true; setMenuDismissed(true); }} onCompositionEnd={event => { composing.current = false; compositionEnded.current = Date.now(); setCaret(event.currentTarget.selectionStart); setMenuDismissed(false); }}
            onKeyDown={event => {
              if (isCompositionKey(event.nativeEvent, composing.current, compositionEnded.current)) return;
              if (menuOpen) {
                if (event.key === 'Escape') { event.preventDefault(); setMenuDismissed(true); return; }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex(index => items.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0); return; }
                if ((event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey)) && items[selectedIndex]) { event.preventDefault(); void selectContext(items[selectedIndex]); return; }
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); return; }
              }
              if (event.key !== 'Enter') return;
              const send = !event.shiftKey && !event.altKey && (state.settings.sendKey === 'ctrl-enter' ? hasPrimaryModifier(event) : !event.ctrlKey && !event.metaKey || hasPrimaryModifier(event));
              if (send) { event.preventDefault(); if (!disabled) void submit(); }
            }} />
          <div className="group/toolbar flex flex-wrap items-end gap-x-2 gap-y-2">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Button variant="ghost" size="icon-md" type="button" disabled={disabled} title={`${t('attach')} · ${primaryKey}+V`} aria-label={t('attach')} onClick={() => void run(window.grokdesk.chooseAttachments(conversation.id))}>{pasting ? <LoaderCircle className="animate-spin" /> : <Plus />}</Button>
              {modeOptions.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" type="button" disabled={disabled} className="gap-1 text-foreground-subtle" title={t('mode')}><ShieldCheck className="size-3.5" /><span className="composer-mode-label max-w-32 truncate">{modeOptions[0].options.find(o => o.value === modeOptions[0].currentValue)?.name ?? t('mode')}</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="max-w-80">
                  {modeOptions.length === 0 ? <DropdownMenuLabel className="whitespace-normal text-ui-sm font-normal leading-relaxed text-foreground-subtle">{t('modeNote')}</DropdownMenuLabel> : modeOptions.map(option => <div key={option.id}><DropdownMenuLabel>{option.name}</DropdownMenuLabel>{option.options.map(value => <DropdownMenuItem key={value.value} onSelect={() => void config(option.id, value.value)}><Check className={cn('size-3', value.value !== option.currentValue && 'invisible')} />{value.name}</DropdownMenuItem>)}</div>)}
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" type="button" disabled={disabled || !models.length} className="max-w-56 gap-1 text-foreground-subtle" title={t('model')}><span className="max-w-44 truncate">{model?.name ?? models.find(m => m.id === modelOption?.currentValue)?.name ?? t('model')}</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="max-h-80 min-w-56 overflow-y-auto"><DropdownMenuLabel>{t('model')}</DropdownMenuLabel>{models.map(item => <DropdownMenuItem key={item.id} onSelect={() => void config(modelOption?.id ?? 'model', item.id)}><Check className={cn('size-3', item.id !== conversation.currentModelId && item.id !== modelOption?.currentValue && 'invisible')} /><span>{item.name}</span></DropdownMenuItem>)}</DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" type="button" disabled={disabled || !efforts.length} className="gap-1 text-foreground-subtle" title={efforts.length ? t('effort') : t('noEffort')}><span>{efforts.find(e => e.id === (effortOption?.currentValue ?? conversation.currentEffort))?.label ?? t('effort')}</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top"><DropdownMenuLabel>{t('effort')}</DropdownMenuLabel>{efforts.map(item => <DropdownMenuItem key={item.id} onSelect={() => void config(effortOption?.id ?? 'reasoning_effort', item.id)}><Check className={cn('size-3', item.id !== (effortOption?.currentValue ?? conversation.currentEffort) && 'invisible')} />{item.label}</DropdownMenuItem>)}</DropdownMenuContent>
              </DropdownMenu>
              {isRunning ? <Button type="button" size="icon-md" title={t('stop')} aria-label={t('stop')} className="rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80" onClick={() => void run(window.grokdesk.cancel(conversation.id))}><Square className="size-3 fill-current" /></Button> : <Button type="submit" size="icon-md" title={t('send')} aria-label={t('send')} disabled={disabled || (!draft.trim() && !conversation.attachments.length) || state.engine.state !== 'ready'} className="rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80">{connecting || configuring ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Button>}
            </div>
          </div>
        </div>
      </form>
    </div>
    <ComposerContextBar conversation={conversation} state={state} draft={draft} disabled={disabled} run={run} onChangeWorkspace={changeWorkspace} onAddWorkspace={addWorkspace} onSelectContext={selectExtension} onToggleTerminal={onToggleTerminal} terminalVisible={terminalVisible} />
  </div>;
}
