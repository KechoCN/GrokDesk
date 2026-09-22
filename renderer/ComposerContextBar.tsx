import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, ExternalLink, Folder, FolderOpen, Laptop, LoaderCircle, Plug, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type { AppSnapshot, ContextItem, Conversation } from '../shared/api';
import { Button } from './components/ui/button';
import { cn } from './components/lib/utils';
import { errorMessage, type RunAction } from './useDesk';
import './composer-context-bar.css';

interface ComposerContextBarProps {
  conversation: Conversation;
  state: AppSnapshot;
  draft: string;
  disabled: boolean;
  run: RunAction;
  onChangeWorkspace: (workspaceId: string | null) => Promise<boolean>;
  onAddWorkspace: () => Promise<boolean>;
  onSelectContext: (item: ContextItem) => Promise<boolean>;
  onToggleTerminal?: () => void;
  terminalVisible?: boolean;
}

// Keep search fields and result buttons in one predictable keyboard sequence.
// Radix handles Escape, outside click, focus restoration and viewport collision.
function moveResultFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-picker-item]:not(:disabled)'));
  if (!choices.length) return;
  event.preventDefault();
  const current = choices.indexOf(document.activeElement as HTMLButtonElement);
  const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
  choices[next].focus();
}

export function ComposerContextBar({ conversation, state, draft, disabled, run, onChangeWorkspace, onAddWorkspace, onSelectContext, onToggleTerminal, terminalVisible = state.settings.terminalVisible }: ComposerContextBarProps) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [extensionQuery, setExtensionQuery] = useState('');
  const [extensions, setExtensions] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [revision, setRevision] = useState(0);
  const projectSearch = useRef<HTMLInputElement>(null);
  const extensionSearch = useRef<HTMLInputElement>(null);
  const workspace = state.workspaces.find(item => item.id === conversation.workspaceId);
  const workspaces = state.workspaces.filter(item => (!item.archived || item.id === conversation.workspaceId) && `${item.name} ${item.path}`.toLocaleLowerCase().includes(projectQuery.toLocaleLowerCase().trim()))
    .sort((a, b) => Number(b.id === conversation.workspaceId) - Number(a.id === conversation.workspaceId) || Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));

  useEffect(() => {
    if (!extensionsOpen) return;
    let cancelled = false;
    setLoading(true); setWarning(''); setExtensions([]); setTruncated(false);
    const timer = window.setTimeout(() => {
      void window.grokdesk.contextCatalog(conversation.id, 'command', extensionQuery).then(result => {
        if (cancelled) return;
        setExtensions(result.items.filter(item => item.kind === 'skill' || item.kind === 'plugin'));
        setWarning(result.warning ?? ''); setTruncated(result.truncated);
      }).catch(error => { if (!cancelled) setWarning(errorMessage(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [extensionsOpen, conversation.id, conversation.cwd, extensionQuery, revision]);

  function selected(item: ContextItem) {
    return (item.path && conversation.attachments.some(file => file.sourcePath === item.path || file.path === item.path)) || (item.insertText && draft.includes(item.insertText));
  }

  return <div className="composer-context-bar" aria-label="任务上下文和本机工具">
    <Popover.Root open={projectOpen} onOpenChange={open => { setProjectOpen(open); if (open) { setProjectQuery(''); setExtensionsOpen(false); } }}>
      <Popover.Trigger asChild><Button type="button" variant="ghost" size="sm" disabled={disabled} className="composer-context-trigger" aria-label="选择项目" title={workspace?.path ?? '为当前任务选择项目'}><Folder className="size-3.5" /><span className="composer-project-name">{workspace?.name ?? '进入项目工作'}</span><ChevronDown className="size-3 text-foreground-subtlest" /></Button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="composer-context-popover composer-project-popover" side="bottom" align="start" sideOffset={7} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); projectSearch.current?.focus(); }} aria-label="选择项目" onKeyDown={moveResultFocus}>
        <div className="composer-picker-search"><Search className="size-3.5" /><input ref={projectSearch} value={projectQuery} onChange={event => setProjectQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />{projectQuery && <Button type="button" variant="ghost" size="icon-xs" aria-label="清除项目搜索" onClick={() => { setProjectQuery(''); projectSearch.current?.focus(); }}><X /></Button>}</div>
        <div className="composer-picker-results" aria-label="项目列表">
          {workspaces.map(item => <button type="button" key={item.id} data-picker-item className={cn('composer-picker-row', item.id === conversation.workspaceId && 'is-selected')} disabled={disabled} aria-pressed={item.id === conversation.workspaceId} title={item.path} onClick={() => { void onChangeWorkspace(item.id).then(changed => { if (changed) setProjectOpen(false); }); }}><Folder className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.id === conversation.workspaceId && <Check className="size-3.5" />}</button>)}
          {!workspaces.length && <p className="composer-picker-message">{projectQuery ? '没有找到匹配的项目' : '添加项目，让 Grok 使用项目中的文件。'}</p>}
        </div>
        <div className="composer-picker-actions">
          <button type="button" data-picker-item className="composer-picker-row" disabled={disabled} onClick={() => { void onAddWorkspace().then(changed => { if (changed) setProjectOpen(false); }); }}><Plus className="size-4" /><span>添加项目</span></button>
          {workspace && <button type="button" data-picker-item className="composer-picker-row" onClick={() => { setProjectOpen(false); void run(window.grokdesk.openFolder(conversation.id)); }}><FolderOpen className="size-4" /><span>在文件资源管理器中打开</span><ExternalLink className="ml-auto size-3 text-foreground-subtlest" /></button>}
          <button type="button" data-picker-item className="composer-picker-row" disabled={disabled} aria-pressed={!conversation.workspaceId} onClick={() => { void onChangeWorkspace(null).then(changed => { if (changed) setProjectOpen(false); }); }}><X className="size-4" /><span>不使用项目</span>{!conversation.workspaceId && <Check className="ml-auto size-3.5" />}</button>
        </div>
        {conversation.messages.length > 0 && <p className="composer-picker-footnote">切换项目将开启新任务，并保留当前草稿和附件。</p>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>

    <Popover.Root open={extensionsOpen} onOpenChange={open => { setExtensionsOpen(open); if (open) { setExtensionQuery(''); setProjectOpen(false); } }}>
      <Popover.Trigger asChild><Button type="button" variant="ghost" size="sm" disabled={disabled} className="composer-context-trigger" aria-label="技能与插件" title="添加已安装的技能与插件"><Plug className="size-3.5" /><span>插件</span></Button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="composer-context-popover composer-extensions-popover" side="bottom" align="start" sideOffset={7} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); extensionSearch.current?.focus(); }} aria-label="技能与插件" onKeyDown={moveResultFocus}>
        <div className="composer-picker-search"><Search className="size-3.5" /><input ref={extensionSearch} value={extensionQuery} onChange={event => setExtensionQuery(event.target.value)} placeholder="搜索技能与插件" aria-label="搜索技能与插件" /><Button type="button" variant="ghost" size="icon-sm" aria-label="刷新技能与插件" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /></Button></div>
        <div className="composer-picker-results" aria-label="已安装的技能与插件">
          {extensions.map(item => { const isSelected = Boolean(selected(item)); const Icon = item.kind === 'skill' ? Sparkles : Plug; return <button type="button" data-picker-item key={item.id} className={cn('composer-picker-row composer-extension-row', isSelected && 'is-selected')} disabled={disabled || isSelected} aria-pressed={isSelected} title={isSelected ? '已加入当前草稿' : item.description} onClick={() => { void onSelectContext(item).then(added => { if (added) setExtensionsOpen(false); }); }}><Icon className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.name}</span>{item.description && <span className="composer-extension-description">{item.description}</span>}</span>{isSelected ? <Check className="size-3.5 shrink-0" /> : <span className="composer-extension-kind">{item.kind === 'skill' ? '技能' : '插件'}</span>}</button>; })}
          {loading && <div role="status" className="composer-picker-message flex items-center gap-2"><LoaderCircle className="size-3.5 animate-spin" />正在读取已安装的扩展…</div>}
          {!loading && !extensions.length && !warning && <p className="composer-picker-message">{extensionQuery ? '没有找到匹配的技能或插件。' : '暂无可用扩展。安装到 Grok 后可在这里选择。'}</p>}
        </div>
        {warning && <div className="composer-picker-warning" role="alert"><span>{warning}</span><Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setRevision(value => value + 1)}>重试</Button></div>}
        <p className="composer-picker-footnote">{truncated ? '结果较多，请输入名称继续搜索。' : '选择后加入当前草稿。也可输入 / 调用技能，输入 @ 引用文件。'}</p>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <div className="composer-context-spacer" />
    <Button type="button" variant="ghost" size="icon-sm" aria-label={terminalVisible ? '收起本机终端' : '打开本机终端'} title={terminalVisible ? '收起本机终端' : '打开本机终端'} aria-pressed={terminalVisible} className="composer-context-terminal" onClick={() => { if (onToggleTerminal) onToggleTerminal(); else void run(window.grokdesk.updateSettings({ terminalVisible: !terminalVisible })); }}><Laptop className="size-3.5" /></Button>
  </div>;
}
