// Presentation adapted from ZCode WorkspaceSidebar/NewTaskButtonGroup/TaskListItem,
// Apache-2.0, 872ad960de7ec172591f7e1952f7849229f94521. ZCode services replaced by GrokDesk IPC.
import { useEffect, useRef, useState } from 'react';
import grokIcon from '../Assets/grok-mobile.png';
import { Archive, ChevronDown, ChevronRight, Ellipsis, Folder, MessageCirclePlus, PanelLeftClose, Pin, Plus, Search, Settings, UserRound } from 'lucide-react';
import type { AppSnapshot, Conversation, Workspace } from '../shared/api';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { cn } from './components/lib/utils';
import { useText } from './i18n';
import type { RunAction } from './useDesk';
import { AccountMenu } from './AccountMenu';
import { primaryKey } from './platform';

export type EditRequest = { kind: 'rename' | 'workspaceRename' | 'delete'; id?: string; value: string };
export function Sidebar({ state, run, onSelect, onNew, onSettings, onEdit, onCollapse, onUsage, onChat, onOverlayChange }: {
  state: AppSnapshot; run: RunAction; onSelect: (id: string) => void; onSettings: () => void;
  onNew: (workspaceId?: string) => void;
  onEdit: (request: EditRequest) => void; onCollapse: () => void; onUsage: () => void; onChat?: () => void; onOverlayChange?: (open: boolean) => void;
}) {
  const t = useText();
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const visibleWorkspaces = state.workspaces.filter(workspace => archived || !workspace.archived);
  const conversations = state.conversations.filter(c => (c.archived || !!state.workspaces.find(w => w.id === c.workspaceId)?.archived) === archived && c.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pinned = conversations.filter(c => c.pinned);
  const loose = conversations.filter(c => !c.workspaceId && !c.pinned);
  const toggle = (id: string) => setCollapsed(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  useEffect(() => {
    const active = state.conversations.find(conversation => conversation.id === state.activeConversationId);
    if (active) { setArchived(active.archived || !!state.workspaces.find(workspace => workspace.id === active.workspaceId)?.archived); setQuery(''); }
  }, [state.activeConversationId]);
  function newTask(workspaceId?: string) {
    setArchived(false); setQuery('');
    onNew(workspaceId);
  }

  // Render helpers preserve each row's React identity while streaming snapshots
  // update the sidebar, so an open Radix menu is not repeatedly unmounted.
  function renderConversationRow(item: Conversation) {
    return <div key={item.id} className={cn('task-row group flex min-w-0 items-center rounded-lg', item.id === state.activeConversationId ? 'bg-selected' : 'hover:bg-surface-hover')}>
      <button className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-3 pr-1 text-left text-ui-base" onClick={() => onSelect(item.id)} title={item.title}>
        <span className={cn('status-dot shrink-0', `phase-${item.phase}`, item.phase === 'ready' && 'opacity-0')} />
        <span className="min-w-0 flex-1 truncate">{item.title || t('untitled')}</span>
        {item.pinned && <Pin className="size-3 shrink-0 text-foreground-subtlest" />}
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={t('more')} title={t('more')} variant="ghost" size="icon-xs" className="mr-1 shrink-0 text-foreground-subtle opacity-60 group-hover:opacity-100"><Ellipsis /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-44">
          <DropdownMenuItem onSelect={() => onEdit({ kind: 'rename', id: item.id, value: item.title })}>{t('rename')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(window.grokdesk.updateConversation(item.id, { pinned: !item.pinned }))}>{t(item.pinned ? 'unpin' : 'pinned')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(window.grokdesk.updateConversation(item.id, { archived: !item.archived }))}>{t(item.archived ? 'restore' : 'archive')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(window.grokdesk.exportConversation(item.id))}>{t('export')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" disabled={['connecting', 'running', 'waiting', 'cancelling'].includes(item.phase)} onSelect={() => onEdit({ kind: 'delete', id: item.id, value: item.title })}>{t('remove')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>;
  }

  function renderWorkspaceGroup(workspace: Workspace) {
    const rows = conversations.filter(c => c.workspaceId === workspace.id && !c.pinned);
    if (query && rows.length === 0) return null;
    return <section key={workspace.id} className="mb-3">
      <div className="group flex h-8 min-w-0 items-center gap-1 px-1">
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-ui-base text-foreground-subtle hover:text-foreground" onClick={() => toggle(workspace.id)} title={workspace.path} aria-expanded={!collapsed.has(workspace.id)}>
          {collapsed.has(workspace.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          {workspace.archived ? <Archive className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />}<span className="truncate">{workspace.name}</span>
        </button>
        {!workspace.archived && <Button variant="ghost" size="icon-xs" title={t('new')} aria-label={t('new')} onClick={() => newTask(workspace.id)}><Plus /></Button>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('more')}><Ellipsis /></Button></DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onSelect={() => onEdit({ kind: 'workspaceRename', id: workspace.id, value: workspace.name })}>{t('rename')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run(window.grokdesk.updateWorkspace(workspace.id, { pinned: !workspace.pinned }))}>{t(workspace.pinned ? 'unpin' : 'pinned')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run(window.grokdesk.updateWorkspace(workspace.id, { archived: !workspace.archived }))}>{t(workspace.archived ? 'restore' : 'archive')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(!collapsed.has(workspace.id) || !!query) && <div className="pl-3">{rows.map(renderConversationRow)}</div>}
    </section>;
  }

  return <aside className="sidebar flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-foreground">
    <div className="window-drag flex h-12 shrink-0 items-center justify-between px-3">
      <div className="flex items-center gap-2 text-ui-base font-medium"><img src={grokIcon} className="size-5 rounded-md" alt="" />GrokDesk</div>
      <Button variant="ghost" size="icon-sm" className="window-no-drag text-foreground-subtle" aria-label={t('collapse')} title={t('collapse')} onClick={onCollapse}><PanelLeftClose /></Button>
    </div>
    <div className="flex shrink-0 flex-col gap-1 px-2 py-2">
      <button className="group inline-flex h-8 w-full shrink-0 items-center justify-stretch gap-2 overflow-hidden rounded-lg px-2.5 text-ui-base hover:bg-surface-hover" onClick={() => newTask()}>
        <MessageCirclePlus className="size-4 shrink-0" /><span>{t('new')}</span><span className="ml-auto text-ui-xs text-foreground-subtlest">{primaryKey} N</span>
      </button>
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-foreground-subtle" />
        <Input ref={search} aria-label={t('search')} placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)} className="h-8 border-transparent bg-transparent pl-9 hover:bg-surface-hover focus:bg-input" />
      </div>
    </div>
    <div className="mb-2 flex shrink-0 items-center justify-between px-3 pt-2">
      <span className="text-ui-sm font-medium text-foreground-subtlest">{t(archived ? 'archived' : 'projects')}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-xs" aria-label={t('archive')} title={t('archive')} className={archived ? 'bg-selected text-foreground' : 'text-foreground-subtle'} onClick={() => setArchived(v => !v)}><Archive /></Button>
        <Button variant="ghost" size="icon-xs" aria-label={t('openWorkspace')} title={t('openWorkspace')} onClick={() => void run(window.grokdesk.addWorkspace())}><Plus /></Button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {pinned.length > 0 && <section className="mb-4"><h3 className="px-3 py-2 text-ui-sm text-foreground-subtlest">{t('pinned')}</h3>{pinned.map(renderConversationRow)}</section>}
      {visibleWorkspaces.sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(renderWorkspaceGroup)}
      {state.workspaces.length === 0 && !query && <button className="mb-6 w-full rounded-lg px-3 py-3 text-left text-ui-sm text-foreground-subtlest hover:bg-hover" onClick={() => void run(window.grokdesk.addWorkspace())}>{t('noProjects')}</button>}
      <section><div className="mb-1 flex items-center justify-between px-3 text-ui-sm text-foreground-subtlest"><h3>{t('chats')}</h3><Button variant="ghost" size="icon-xs" aria-label={t('new')} onClick={() => newTask()}><Plus /></Button></div>{loose.map(renderConversationRow)}</section>
      {conversations.length === 0 && <p className="px-3 py-4 text-ui-sm text-foreground-subtlest">{t(query ? 'noResults' : 'noChats')}</p>}
    </div>
    <div className="shrink-0 p-2"><AccountMenu state={state} run={run} onSettings={onSettings} onChat={onChat} onOverlayChange={onOverlayChange} /></div>
  </aside>;
}
