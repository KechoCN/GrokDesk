import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Gift, Globe, Keyboard, LogIn, RefreshCw, Settings, UserRound } from 'lucide-react';
import type { AccountSnapshot, AppSnapshot, AuthState, WebChatState } from '../shared/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';
import { AccountDetails } from './AccountDetails';
import { errorMessage, type RunAction } from './useDesk';
import { AccountLogin } from './AccountLogin';
import { primaryKey, terminalCopyShortcut, terminalPasteShortcut } from './platform';
import './account-menu.css';

export function AccountMenu({ state, run, onSettings, onChat, onOverlayChange }: { state: AppSnapshot; run: RunAction; onSettings: () => void; onChat?: () => void; onOverlayChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false), [login, setLogin] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const [info, setInfo] = useState<'features' | 'shortcuts' | 'help' | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null), [loading, setLoading] = useState(false);
  const [web, setWeb] = useState<WebChatState | null>(null), [auth, setAuth] = useState<AuthState | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const refreshing = useRef(false);
  const L = (zh: string, en: string) => state.settings.language === 'en-US' ? en : zh;
  useEffect(() => { onOverlayChange?.(open || login || helpOpen || !!info); return () => onOverlayChange?.(false); }, [open, login, helpOpen, info, onOverlayChange]);
  useEffect(() => { if (open) void refresh(); }, [open, state.engine.state]);
  useEffect(() => {
    let mounted = true;
    const sync = () => {
      void window.grokdesk.webStatus().then(value => { if (mounted) setWeb(value); }).catch(() => {});
      void window.grokdesk.authStatus().then(value => { if (mounted) setAuth(value); }).catch(() => {});
    };
    const off = window.grokdesk.onEvent(event => {
      if (event.type === 'web') setWeb(event.state);
      if (event.type === 'auth') setAuth(event.state);
    });
    sync(); window.addEventListener('focus', sync);
    return () => { mounted = false; off(); window.removeEventListener('focus', sync); };
  }, [state.engine.state]);
  useEffect(() => setAvatarFailed(false), [web?.account?.avatarUrl]);
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true; setLoading(true);
    try { setAccount(await window.grokdesk.account()); }
    catch (error) { setAccount({ state: 'error', source: 'grok-cloud', checkedAt: new Date().toISOString(), error: errorMessage(error) }); }
    finally { refreshing.current = false; setLoading(false); }
  }
  const nickname = web?.account?.nickname || [auth?.profile?.firstName, auth?.profile?.lastName].filter(Boolean).join(' ') || auth?.profile?.email || L('连接 Grok 账号', 'Connect Grok account');
  const avatar = web?.account?.avatarUrl;
  const connectionLabel = web?.connection === 'connected' ? L('已连接本机浏览器', 'Local browser connected') : web?.account ? L('最近同步的官网账号', 'Last synced website account') : L('连接浏览器后自动同步头像与昵称', 'Connect your browser to sync your name and avatar');
  const shortcuts = [
    [`${primaryKey} + N`, L('新建 Build 任务', 'New Build task')], [`${primaryKey} + ,`, L('打开设置', 'Open settings')],
    [state.settings.sendKey === 'ctrl-enter' ? `${primaryKey} + Enter` : 'Enter', L('发送消息', 'Send message')],
    ['Shift + Enter', L('输入换行', 'New line')], [`${primaryKey} + V`, L('粘贴文字、截图或文件', 'Paste text, screenshots or files')],
    [terminalCopyShortcut, L('复制终端选中文字', 'Copy terminal selection')], [terminalPasteShortcut, L('粘贴到终端', 'Paste into terminal')],
    ['Ctrl+C', L('停止终端当前任务', 'Stop the current terminal task')],
    ['/', L('查找命令、技能和插件', 'Find commands, skills and plugins')], ['@', L('添加项目文件', 'Add project files')],
  ];
  return <>
    <div className="account-footer">
      <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild><button aria-label={L('账号与云端额度', 'Account and cloud allowance')} className="account-identity" title={connectionLabel}>
        <span className="account-avatar">{avatar && !avatarFailed ? <img src={avatar} referrerPolicy="no-referrer" alt="" onError={() => setAvatarFailed(true)} /> : <UserRound size={16} />}</span>
        <span className="account-nickname">{nickname}</span><span className={`account-sync-dot ${web?.connection === 'connected' ? 'connected' : ''}`} aria-label={connectionLabel} />
      </button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" className="w-80 max-w-[calc(100vw-24px)]">
        <div className="px-3 py-2"><p className="truncate text-ui-base font-medium">{nickname}</p><p className="mt-1 text-ui-xs text-foreground-subtle">{connectionLabel}</p></div>
        <DropdownMenuSeparator /><div className="p-3"><AccountDetails account={account} language={state.settings.language} /></div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={loading} onSelect={event => { event.preventDefault(); void refresh(); }}><RefreshCw className={loading ? 'animate-spin' : ''} />{L('刷新云端额度', 'Refresh cloud allowance')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLogin(true)}><LogIn />{L('登录 / 切换 Build 账号', 'Sign in / switch Build account')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { onChat?.(); void run(window.grokdesk.webAction('external')); }}><Globe />{L('在本机浏览器管理官网账号', 'Manage website account in browser')}</DropdownMenuItem>
        <DropdownMenuSeparator /><DropdownMenuItem onSelect={onSettings}><Settings />{L('设置', 'Settings')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu open={helpOpen} onOpenChange={setHelpOpen}><DropdownMenuTrigger asChild><button className="account-help" aria-label={L('帮助与更多', 'Help and more')} title={L('帮助与更多', 'Help and more')}><CircleHelp size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-72 rounded-2xl p-2">
          <DropdownMenuItem onSelect={() => setInfo('features')}><Gift />{L('新功能', 'What’s new')}</DropdownMenuItem><DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { onChat?.(); void run(window.grokdesk.webSetup()); }}><Globe />{L('设置 Chrome / Edge 扩展程序', 'Set up Chrome / Edge extension')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setInfo('shortcuts')}><Keyboard />{L('键盘快捷键', 'Keyboard shortcuts')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setInfo('help')}><CircleHelp />{L('帮助', 'Help')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AccountLogin open={login} onOpenChange={setLogin} state={state} />
    <Dialog open={!!info} onOpenChange={value => { if (!value) setInfo(null); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{info === 'shortcuts' ? L('键盘快捷键', 'Keyboard shortcuts') : info === 'features' ? L('新功能', 'What’s new') : L('GrokDesk 帮助', 'GrokDesk help')}</DialogTitle><DialogDescription>{L('你的 Grok 桌面工作区', 'Your Grok desktop workspace')}</DialogDescription></DialogHeader>
      {info === 'shortcuts' ? <div className="space-y-3">{shortcuts.map(([key, description]) => <div key={key} className="flex items-center justify-between gap-5 text-ui-sm"><span>{description}</span><kbd className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-ui-xs">{key}</kbd></div>)}</div> : <div className="space-y-4 text-ui-base leading-6 text-foreground-subtle">
        <p>{L('聊天模式连接本机 Chrome / Edge 中的 Grok 标签页，沿用该浏览器里的官网登录。首次使用请从「设置 Chrome / Edge 扩展程序」完成连接，保持 Grok 网页打开。', 'Chat connects to a Grok tab in Chrome / Edge using your existing website sign-in. Set up the browser extension once and keep the Grok tab open.')}</p>
        <p>{L('输入框下方可搜索、切换或添加项目，也可选择不使用项目。切换时未发送的草稿和附件会带到新任务，原来的对话保留。插件入口可查找本机安装的插件与技能并加入任务。', 'Use the bar below the composer to find, switch or add projects and insert installed plugins and skills. Switching carries your unsent draft and attachments into a new task and preserves your existing conversation.')}</p>
        <p>{L('Grok 工作后，右上角显示任务清单、产物和参考。可展开、收起或点击文件进行预览；进度来自 Grok 实际返回的数据。', 'Once Grok starts working, the upper-right panel shows its task list, outputs and references. Collapse sections or click files to preview them.')}</p>
        {info === 'help' && <p>{L('Build 使用本机 Grok Build 引擎；连接异常可到设置检查引擎路径与登录状态。聊天发送、图片、搜索等能力取决于官网当前页面及账号权限；连接断开时可直接回到本机浏览器继续。', 'Build uses your local Grok Build engine; check its path and sign-in in Settings if it cannot connect. Chat capabilities depend on the website and your account. You can always continue in your browser.')}</p>}
      </div>}
    </DialogContent></Dialog>
  </>;
}
