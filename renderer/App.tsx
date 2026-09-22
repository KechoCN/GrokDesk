// GrokDesk application shell. Layout adapted from ZCode WorkspaceShellLayout,
// ConversationDraftEmptyState and SidePaneTabTrigger, Apache-2.0.
// Upstream: 872ad960de7ec172591f7e1952f7849229f94521. All actions use the GrokDesk bridge.
import { useEffect, useRef, useState } from 'react';
import grokIcon from '../Assets/grok-mobile.png';
import { AlertCircle, Ellipsis, FolderOpen, Globe, LoaderCircle, Maximize2, MessageCircle, MessageCirclePlus, Minus, PanelLeft, PanelRight, Settings, ShieldCheck, SquareTerminal, X } from 'lucide-react';
import type { AppSnapshot, Permission } from '../shared/api';
import { DesktopWindowFrame } from './DesktopWindowFrame';
import { Sidebar, type EditRequest } from './Sidebar';
import { Composer, flushComposerDraft } from './Composer';
import { ConversationDropZone } from './ConversationDropZone';
import { Timeline } from './Timeline';
import { TerminalPanel } from './TerminalPanel';
import { SettingsPanel } from './SettingsPanel';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { cn } from './components/lib/utils';
import { LanguageContext, useText } from './i18n';
import { errorMessage, useDesk, type RunAction } from './useDesk';
import { resolveTheme } from './themes';
import { PreviewPanel } from './PreviewPanel';
import { ResizeHandle } from './ResizeHandle';
import { WebChat } from './WebChat';
import { WorkPanel } from './WorkPanel';
import { hasPrimaryModifier, isMac, isWindows, platform } from './platform';

function savedSize(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function PermissionDialog({ permission, state, notify }: { permission?: Permission; state: AppSnapshot; notify: (message: string) => void }) {
  const t = useText();
  const [responding, setResponding] = useState(false);
  useEffect(() => setResponding(false), [permission?.requestId]);
  async function respond(option: string | null) {
    if (!permission || responding) return;
    setResponding(true);
    try { await window.grokdesk.respondPermission(permission.requestId, option); }
    catch (error) { notify(errorMessage(error)); setResponding(false); }
  }
  const conversation = state.conversations.find(c => c.id === permission?.conversationId);
  return <Dialog open={!!permission} onOpenChange={open => { if (!open) void respond(null); }}><DialogContent className="max-w-2xl" showCloseButton={!responding}>
    <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />{t('permission')}</DialogTitle><DialogDescription className="break-words">{conversation?.title}</DialogDescription></DialogHeader>
    <div className="text-ui-base font-medium">{permission?.title}</div>
    <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-surface p-4 font-mono text-ui-sm leading-relaxed">{permission?.detail}</pre>
    {permission?.options.length === 0 && <p className="text-ui-sm text-foreground-subtle">{t('noPermissionOptions')}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={responding} onClick={() => void respond(null)}>{t('deny')}</Button>{permission?.options.map(option => <Button key={option.optionId} disabled={responding} variant={option.kind.includes('reject') ? 'outline' : 'default'} title={option.kind} onClick={() => void respond(option.optionId)}>{option.name}</Button>)}</div>
  </DialogContent></Dialog>;
}

function DeskView({ state, run, notice, notify }: { state: AppSnapshot; run: RunAction; notice: string | null; notify: (message: string | null) => void }) {
  const t = useText();
  const active = state.conversations.find(c => c.id === state.activeConversationId);
  const L = (zh: string, en: string) => state.settings.language === 'en-US' ? en : zh;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => savedSize('grokdesk-sidebar-width', 264));
  const [previewWidth, setPreviewWidth] = useState(() => savedSize('grokdesk-preview-width', 350));
  const [terminalHeight, setTerminalHeight] = useState(() => savedSize('grokdesk-terminal-height', 260));
  const [previewOpen, setPreviewOpen] = useState(() => localStorage.getItem('grokdesk-preview-open') === 'true');
  const [previewRequest, setPreviewRequest] = useState<{ conversationId: string; path?: string; sequence: number }>();
  const [mode, setMode] = useState<'build' | 'chat'>(() => localStorage.getItem('grokdesk-mode') === 'chat' ? 'chat' : 'build');
  const [resizing, setResizing] = useState(false);
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [tabs, setTabs] = useState<string[]>(state.activeConversationId ? [state.activeConversationId] : []);
  const [closingTab, setClosingTab] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editPending, setEditPending] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [terminalVisible, setTerminalVisible] = useState(state.settings.terminalVisible);
  const { dark, className: themeClass } = resolveTheme(state.settings.theme, systemDark);
  const permission = state.permissions[0];
  const visibleTabs = tabs.map(id => state.conversations.find(c => c.id === id)).filter(c => c != null);
  const hasContent = active && active.messages.length > 0;
  const shell = useRef<HTMLDivElement>(null);
  const effectiveSidebarWidth = Math.max(208, Math.min(sidebarWidth, viewport.width * 0.34));
  const availableWidth = viewport.width - (sidebarOpen ? effectiveSidebarWidth : 44) - 22;
  const effectivePreviewWidth = Math.max(220, Math.min(previewWidth, availableWidth - 400));
  const effectiveTerminalHeight = Math.max(140, Math.min(terminalHeight, viewport.height - 290));

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { localStorage.setItem('grokdesk-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('grokdesk-preview-width', String(previewWidth)); }, [previewWidth]);
  useEffect(() => { localStorage.setItem('grokdesk-terminal-height', String(terminalHeight)); }, [terminalHeight]);
  useEffect(() => { localStorage.setItem('grokdesk-preview-open', String(previewOpen)); }, [previewOpen]);
  useEffect(() => { localStorage.setItem('grokdesk-mode', mode); }, [mode]);
  useEffect(() => {
    if (state.settings.copyOnSelect === false) return;
    let started: { x: number; y: number; text: string } | null = null;
    let timer = 0;
    const excluded = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return !!element?.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .terminal-panel, [role="separator"]');
    };
    const down = (event: MouseEvent) => { started = event.button === 0 && !excluded(event.target as Node) ? { x: event.clientX, y: event.clientY, text: window.getSelection()?.toString() || '' } : null; };
    const up = (event: MouseEvent) => {
      const origin = started; started = null;
      if (!origin || event.button !== 0 || excluded(event.target as Node)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString() || '';
        if (!selection || !text.trim() || excluded(selection.anchorNode) || excluded(selection.focusNode)) return;
        if (text === origin.text && Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y) < 3 && event.detail < 2) return;
        void window.grokdesk.writeClipboard(text).catch(reason => notify(errorMessage(reason)));
      }, 0);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('mouseup', up);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up); window.clearTimeout(timer); };
  }, [state.settings.copyOnSelect, notify]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    for (const theme of ['theme-zai-dark', 'theme-zai-light', 'theme-lagoon', 'theme-midnight', 'theme-forest', 'theme-rose']) root.classList.toggle(theme, theme === themeClass);
    root.style.setProperty('--ui-font-size', `${state.settings.fontSize}px`);
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.lang = state.settings.language;
  }, [dark, themeClass, state.settings.fontSize, state.settings.language]);
  useEffect(() => { if (state.activeConversationId) setTabs(old => old.includes(state.activeConversationId!) ? old : [...old, state.activeConversationId!]); }, [state.activeConversationId]);
  useEffect(() => { const ids = new Set(state.conversations.map(c => c.id)); setTabs(old => old.filter(id => ids.has(id))); }, [state.conversations]);
  useEffect(() => setTerminalVisible(state.settings.terminalVisible), [state.settings.terminalVisible]);
  useEffect(() => { if (permission) { setSettingsOpen(false); setEdit(null); } }, [permission?.requestId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.shiftKey || !hasPrimaryModifier(event) || target?.closest('.terminal-panel, [role="dialog"]')) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); newTask(); }
      if (event.key === ',') { event.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [run]);

  function newTask(workspaceId?: string) { setMode('build'); void run((async () => { await flushComposerDraft(); return window.grokdesk.newConversation(workspaceId); })()); }
  function select(id: string) { setMode('build'); if (id !== state.activeConversationId) void run((async () => { await flushComposerDraft(); return window.grokdesk.selectConversation(id); })()); }
  function requestEdit(request: EditRequest) { setEdit(request); setEditValue(request.value); }
  async function saveEdit() {
    if (!edit || editPending || (edit.kind !== 'delete' && !editValue.trim())) return;
    setEditPending(true);
    try {
      let result: AppSnapshot | undefined;
      if (edit.kind === 'workspaceRename') result = await run(window.grokdesk.updateWorkspace(edit.id!, { name: editValue.trim() }));
      else if (edit.kind === 'rename') result = await run(window.grokdesk.updateConversation(edit.id!, { title: editValue.trim() }));
      else result = await run(window.grokdesk.deleteConversation(edit.id!));
      if (result) setEdit(null);
    } finally { setEditPending(false); }
  }
  async function showUsage() {
    if (!active) return;
    setUsage(t('loading'));
    try { setUsage(await window.grokdesk.usage(active.id)); }
    catch (error) { setUsage(errorMessage(error)); }
  }
  async function closeTab(id: string) {
    if (closingTab) return;
    setClosingTab(id);
    try {
      await flushComposerDraft();
      const last = tabs.filter(tab => tab !== id && state.conversations.some(c => c.id === tab)).at(-1);
      if (id === active?.id && last) {
        const selected = await run(window.grokdesk.selectConversation(last));
        if (!selected) return;
      }
      const result = await run(window.grokdesk.closeConversation(id));
      if (result) setTabs(current => current.filter(tab => tab !== id));
    } catch (error) { notify(errorMessage(error)); }
    finally { setClosingTab(null); }
  }

  return <DesktopWindowFrame title="GrokDesk" isDesktop={!!platform} isWindowsDesktop={isWindows} isMacDesktop={isMac}>
    <div ref={shell} className="flex h-full min-h-0 gap-1 p-1">
      {sidebarOpen ? <div className="relative min-h-0 shrink-0" style={{ width: effectiveSidebarWidth }}><Sidebar state={state} run={run} onSelect={select} onNew={newTask} onSettings={() => setSettingsOpen(true)} onEdit={requestEdit} onCollapse={() => setSidebarOpen(false)} onUsage={() => void showUsage()} onChat={() => setMode('chat')} onOverlayChange={setSidebarOverlay} />
        <ResizeHandle className="sidebar-resizer" label={L('导航栏宽度', 'Sidebar width')} orientation="vertical" value={effectiveSidebarWidth} min={208} max={viewport.width * 0.34} onChange={setSidebarWidth} onDragChange={setResizing} />
      </div> : <div className="window-drag flex w-11 shrink-0 flex-col items-center gap-2 pt-3"><Button variant="ghost" size="icon-md" className="window-no-drag" title={t('expand')} aria-label={t('expand')} onClick={() => setSidebarOpen(true)}><PanelLeft /></Button><Button variant="ghost" size="icon-md" className="window-no-drag" title={t('new')} aria-label={t('new')} onClick={() => newTask()}><MessageCirclePlus /></Button><div className="flex-1" /><Button variant="ghost" size="icon-md" className="window-no-drag mb-2" title={t('settings')} onClick={() => setSettingsOpen(true)}><Settings /></Button></div>}
      <div className="flex min-h-0 min-w-0 flex-1 gap-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="desk-main-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
          <header className="window-drag flex h-11 shrink-0 items-center gap-1 border-b border-border bg-header pl-2">
            <div className="mode-switch window-no-drag mr-1 flex shrink-0 rounded-lg bg-surface p-0.5" role="group" aria-label={L('工作模式', 'Workspace mode')}><button className={cn('rounded-md px-2.5 py-1 text-ui-sm', mode === 'build' ? 'bg-card font-medium text-foreground shadow-sm' : 'text-foreground-subtle hover:text-foreground')} aria-pressed={mode === 'build'} onClick={() => setMode('build')}>Build</button><button className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-sm', mode === 'chat' ? 'bg-card font-medium text-foreground shadow-sm' : 'text-foreground-subtle hover:text-foreground')} aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}><Globe className="size-3.5" />{L('聊天', 'Chat')}</button></div>
            <div className="desk-tabs window-drag flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden self-stretch pt-1">
              {mode === 'build' && visibleTabs.map(conversation => <div key={conversation.id} className={cn('window-no-drag desk-tab group flex h-full min-w-15 max-w-39 flex-1 basis-39 items-center gap-1 rounded-t-lg px-2 text-ui-sm', conversation.id === active?.id ? 'bg-background text-foreground' : 'text-foreground-subtle hover:bg-hover')}>
                <button className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => select(conversation.id)} title={conversation.title}><MessageCircle className="size-3.5 shrink-0" /><span className="truncate">{conversation.title}</span>{['running', 'waiting'].includes(conversation.phase) && <span className={`status-dot phase-${conversation.phase}`} />}</button>
                <button className="rounded p-0.5 text-foreground-subtlest opacity-0 hover:bg-hover focus:opacity-100 group-hover:opacity-100 disabled:opacity-40" disabled={closingTab !== null} title={t('close')} aria-label={`${t('close')} ${conversation.title}`} onClick={() => void closeTab(conversation.id)}><X className="size-3" /></button>
              </div>)}
            </div>
            <div className="header-drag-spacer window-drag h-full w-14 shrink-0" aria-hidden="true" />
            <div className="window-no-drag flex shrink-0 items-center gap-1 pl-1">
              {mode === 'build' && <Button variant="ghost" size="icon-sm" aria-label={t('new')} title={t('new')} onClick={() => newTask()}><PlusIcon /></Button>}
              {mode === 'build' && <Button variant="ghost" size="icon-sm" className={terminalVisible ? 'bg-selected' : ''} title={t('terminal')} aria-label={t('terminal')} onClick={() => setTerminalVisible(value => !value)}><SquareTerminal /></Button>}
              <Button variant="ghost" size="icon-sm" className={previewOpen ? 'bg-selected' : ''} title={L('文件预览', 'File preview')} aria-label={L('文件预览', 'File preview')} aria-pressed={previewOpen} onClick={() => setPreviewOpen(value => !value)}><PanelRight /></Button>
              <Button variant="ghost" size="icon-sm" title={t('settings')} aria-label={t('settings')} onClick={() => setSettingsOpen(true)}><Settings /></Button>
            </div>
            {isWindows && <div className="window-no-drag ml-2 flex h-full shrink-0"><button className="window-control" aria-label={t('minimize')} title={t('minimize')} onClick={() => void run(window.grokdesk.window('minimize'))}><Minus className="size-3.5" /></button><button className="window-control" aria-label={t('maximize')} title={t('maximize')} onClick={() => void run(window.grokdesk.window('maximize'))}><Maximize2 className="size-3" /></button><button className="window-control window-close" aria-label={t('close')} title={t('close')} onClick={() => void run((async () => { await flushComposerDraft(); return window.grokdesk.window('close'); })())}><X className="size-4" /></button></div>}
          </header>
          <WebChat active={mode === 'chat'} suspended={settingsOpen || !!edit || !!permission || usage !== null || sidebarOverlay || resizing} language={state.settings.language} notify={notify} />
          <div className={cn('min-h-0 flex-1 flex-col', mode === 'build' ? 'flex' : 'hidden')}>
          {['missing', 'error'].includes(state.engine.state) && <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-ui-sm"><AlertCircle className="size-4 shrink-0 text-warning" /><span className="min-w-0 flex-1 break-words">{state.engine.error || t('engineMissing')}</span><Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>{t('configure')}</Button></div>}
          {active ? <>
            {hasContent && <div className="flex min-h-10 shrink-0 items-center gap-2 px-5 py-2"><span className="min-w-0 flex-1 truncate text-ui-base font-medium" title={active.cwd}>{active.title}</span><span className={`status-dot phase-${active.phase}`} /><span className="text-ui-xs text-foreground-subtle">{t(active.phase)}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('more')}><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => requestEdit({ kind: 'rename', id: active.id, value: active.title })}>{t('rename')}</DropdownMenuItem><DropdownMenuItem onSelect={() => void run(window.grokdesk.openFolder(active.id))}><FolderOpen />{t('openFolder')}</DropdownMenuItem><DropdownMenuItem onSelect={() => void run(window.grokdesk.exportConversation(active.id))}>{t('export')}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void showUsage()}>{t('usage')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>}
            <ConversationDropZone conversationId={active.id} disabled={['running', 'waiting', 'connecting', 'cancelling'].includes(active.phase)} run={run} notify={notify} className={cn('relative flex min-h-0 flex-1 flex-col', !hasContent && 'empty-conversation justify-center overflow-y-auto px-7 pb-12 pt-10')}>
              {hasContent ? <div className="conversation-workspace"><Timeline conversation={active} run={run} /><WorkPanel conversation={active} language={state.settings.language} onOpenFile={path => { setPreviewRequest({ conversationId: active.id, path, sequence: Date.now() }); setPreviewOpen(true); }} onOpenFolder={() => void run(window.grokdesk.openFolder(active.id))} onOpenExternal={url => void run(window.grokdesk.openExternal(url))} /></div> : <div className="empty-state-greeting mb-10 flex w-full max-w-2xl flex-col items-center justify-center gap-6 self-center text-foreground sm:mb-8"><h1 className="w-full px-4 text-center text-3xl font-medium leading-tight">{t('greeting')}</h1></div>}
              <div className={cn('shrink-0', hasContent ? 'px-6 pb-4 pt-2' : 'w-full max-w-2xl self-center')}><div className="mx-auto w-full max-w-4xl"><Composer key={active.id} conversation={active} state={state} run={run} notify={notify} centered={!hasContent} terminalVisible={terminalVisible} onToggleTerminal={() => setTerminalVisible(value => !value)} /></div></div>
              {!hasContent && <div className="mt-4 flex items-center justify-center gap-2 text-ui-xs text-foreground-subtlest"><span className={`status-dot phase-${active.phase}`} /><span>{t(active.phase)}</span>{state.engine.version && <span>· Grok {state.engine.version}</span>}</div>}
            </ConversationDropZone>
          </> : <div className="flex flex-1 flex-col items-center justify-center gap-5"><img src={grokIcon} alt="" className="size-14 rounded-xl" /><h1 className="text-ui-xl">{t('greeting')}</h1><Button variant="outline" onClick={() => newTask()}><MessageCirclePlus />{t('new')}</Button></div>}
          </div>
        </div>
        {terminalVisible && active && mode === 'build' && <><ResizeHandle label={L('终端高度', 'Terminal height')} orientation="horizontal" value={effectiveTerminalHeight} min={140} max={viewport.height - 290} reverse onChange={setTerminalHeight} onDragChange={setResizing} />{state.engine.state === 'ready' ? <TerminalPanel key={active.id} conversation={active} dark={dark} height={effectiveTerminalHeight} copyOnSelect={state.settings.copyOnSelect !== false} onClose={() => setTerminalVisible(false)} notify={notify} /> : <section className="flex h-16 shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-4 text-ui-sm text-foreground-subtle"><SquareTerminal className="size-4" /><span className="flex-1">{t(state.engine.state === 'missing' || state.engine.state === 'error' ? 'engineMissing' : 'connecting')}</span><Button variant="ghost" size="icon-xs" aria-label={t('close')} onClick={() => setTerminalVisible(false)}><X /></Button></section>}</>}
      </div>
      {previewOpen && <><ResizeHandle label={L('预览栏宽度', 'Preview width')} orientation="vertical" value={effectivePreviewWidth} min={220} max={availableWidth - 400} reverse onChange={setPreviewWidth} onDragChange={setResizing} /><div className="min-h-0 shrink-0" style={{ width: effectivePreviewWidth }}><PreviewPanel conversation={active} requestedFile={previewRequest?.conversationId === active?.id ? previewRequest : undefined} language={state.settings.language} onClose={() => setPreviewOpen(false)} notify={notify} /></div></>}
      </div>
    </div>
    <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} state={state} run={run} notify={notify} onOpenTerminal={() => { setSettingsOpen(false); setMode('build'); setTerminalVisible(true); if (!active) newTask(); }} />
    <Dialog open={!!edit} onOpenChange={open => { if (!open && !editPending) setEdit(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t(edit?.kind === 'delete' ? 'remove' : 'rename')}</DialogTitle><DialogDescription>{edit?.kind === 'delete' ? t('deleteNote') : t('name')}</DialogDescription></DialogHeader>{edit?.kind === 'delete' ? <p className="break-words text-ui-base">{edit.value}</p> : <Input autoFocus size="lg" value={editValue} onChange={event => setEditValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void saveEdit(); }} />}<DialogFooter><Button variant="ghost" disabled={editPending} onClick={() => setEdit(null)}>{t('cancel')}</Button><Button disabled={editPending || (edit?.kind !== 'delete' && !editValue.trim())} variant={edit?.kind === 'delete' ? 'destructive' : 'default'} onClick={() => void saveEdit()}>{t(edit?.kind === 'delete' ? 'remove' : 'save')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={usage !== null} onOpenChange={open => { if (!open) setUsage(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{t('usage')}</DialogTitle><DialogDescription>{t('quota')}</DialogDescription></DialogHeader><pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface p-4 font-mono text-ui-sm">{usage}</pre></DialogContent></Dialog>
    <PermissionDialog permission={permission} state={state} notify={notify} />
    {notice && <div role="status" className="notice-toast fixed bottom-6 left-1/2 z-[80] flex max-w-[min(640px,calc(100vw-48px))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-popover-border bg-popover px-4 py-3 text-ui-sm shadow-lg"><AlertCircle className="mt-0.5 size-4 shrink-0 text-foreground-subtle" /><span className="max-h-48 overflow-y-auto break-words">{notice}</span><button className="shrink-0 text-foreground-subtle" aria-label={t('close')} onClick={() => notify(null)}><X className="size-4" /></button></div>}
  </DesktopWindowFrame>;
}

function PlusIcon() { return <span aria-hidden="true" className="text-xl leading-none">+</span>; }

export default function App() {
  const { state, run, error, notice, setNotice } = useDesk();
  if (!state) return <div className="startup flex h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground">{error ? <><AlertCircle className="size-7" /><p className="max-w-xl px-6 text-center text-ui-base">{error === 'desktop' ? '请通过 GrokDesk 桌面程序打开此界面。' : error}</p></> : <><img src={grokIcon} alt="GrokDesk" className="size-14 rounded-xl" /><LoaderCircle className="size-5 animate-spin text-foreground-subtle" /></>}</div>;
  return <LanguageContext.Provider value={state.settings.language}><DeskView state={state} run={run} notice={notice} notify={setNotice} /></LanguageContext.Provider>;
}
