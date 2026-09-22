// SettingsRow geometry and page presentation from ZCode SettingsPageParts.tsx, Apache-2.0.
// Upstream 872ad960de7ec172591f7e1952f7849229f94521. Settings connect to GrokDesk IPC.
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Code2, CreditCard, Info, Monitor, Moon, Paintbrush, RefreshCw, Settings2, Sun, TerminalSquare } from 'lucide-react';
import type { AccountSnapshot, AppSnapshot, EngineConfig, Settings as SettingsType } from '../shared/api';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { cn } from './components/lib/utils';
import { useText } from './i18n';
import { errorMessage, type RunAction } from './useDesk';
import { themeOptions } from './themes';
import { engineExecutable, platformName } from './platform';

function SettingsRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="border-t border-border px-4 py-4 first:border-t-0"><div className="grid grid-cols-[minmax(0,1fr)_192px] items-center gap-4"><div className="min-w-0"><div className="text-ui-base font-medium text-foreground">{label}</div>{description && <div className="mt-1 text-ui-sm leading-5 text-foreground-subtle">{description}</div>}</div><div className="flex w-full items-center justify-end gap-2">{children}</div></div></div>;
}

export function SettingsPanel({ open, onOpenChange, state, run, notify, onOpenTerminal }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppSnapshot; run: RunAction; notify: (message: string) => void; onOpenTerminal?: () => void }) {
  const t = useText();
  const [page, setPage] = useState<'appearance' | 'general' | 'engine' | 'account' | 'advanced' | 'about'>('appearance');
  const [draft, setDraft] = useState(state.settings);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [configText, setConfigText] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const L = (zh: string, en: string) => state.settings.language === 'en-US' ? en : zh;
  const active = state.conversations.find(conversation => conversation.id === state.activeConversationId);
  const labels = { appearance: t('appearance'), general: t('general'), engine: t('engine'), account: L('订阅与用量', 'Subscription & usage'), advanced: L('Grok 完整设置', 'All Grok settings'), about: t('about') };
  const configChanged = config !== null && configText !== config.content;
  const pathChanged = draft.enginePath.trim() !== state.settings.enginePath;
  useEffect(() => { if (open) { setDraft(state.settings); setConfig(null); setConfigError(''); } }, [open]);
  useEffect(() => { if (open && page === 'account') void refreshAccount(); }, [open, page]);
  useEffect(() => { if (open && page === 'advanced' && !config) void loadConfig(); }, [open, page, config]);
  async function refreshAccount() {
    if (accountLoading) return;
    setAccountLoading(true);
    try { setAccount(await window.grokdesk.account()); }
    catch (error) { setAccount({ state: 'error', source: 'grok-cloud', checkedAt: new Date().toISOString(), error: errorMessage(error) }); }
    finally { setAccountLoading(false); }
  }
  async function loadConfig() {
    if (configLoading) return;
    setConfigLoading(true); setConfigError('');
    try { const value = await window.grokdesk.engineConfig(); setConfig(value); setConfigText(value.content); }
    catch (error) { setConfigError(errorMessage(error)); }
    finally { setConfigLoading(false); }
  }
  async function saveConfig() {
    if (!config || !configChanged) return;
    try {
      const value = await window.grokdesk.saveEngineConfig(configText, config.revision);
      setConfig(value); setConfigText(value.content); setConfigError('');
      notify(L('Grok 配置已保存；重新连接后加载。', 'Grok config saved. Reconnect to load it.'));
    } catch (error) { setConfigError(errorMessage(error)); throw error; }
  }
  async function chooseTheme(theme: SettingsType['theme']) {
    if (saving || theme === state.settings.theme) return;
    setSaving(true);
    try {
      const result = await run(window.grokdesk.updateSettings({ theme }));
      if (result) setDraft(previous => ({ ...previous, theme: result.settings.theme }));
    } catch (error) { notify(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    try { await saveConfig(); const result = await run(window.grokdesk.updateSettings(draft)); if (result) { notify(t('saved')); onOpenChange(false); } }
    catch (error) { notify(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function reconnect() {
    if (saving) return;
    setSaving(true);
    try {
      await saveConfig();
      if (pathChanged) { const result = await run(window.grokdesk.updateSettings({ enginePath: draft.enginePath.trim() })); if (!result) return; }
      await window.grokdesk.reconnect();
    } catch (error) { notify(errorMessage(error)); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}><DialogContent className="flex h-[min(720px,calc(100vh-64px))] w-[min(880px,calc(100vw-48px))] max-w-none flex-col overflow-hidden p-0" showCloseButton={!saving}>
    <div className="shrink-0 border-b border-border px-6 py-4"><DialogTitle>{t('settings')}</DialogTitle><DialogDescription className="sr-only">GrokDesk</DialogDescription></div>
    <div className="flex min-h-0 flex-1">
      <nav className="w-44 shrink-0 border-r border-border bg-surface px-2 py-3">
        {([{ id: 'appearance', icon: Paintbrush }, { id: 'general', icon: Settings2 }, { id: 'account', icon: CreditCard }, { id: 'engine', icon: TerminalSquare }, { id: 'advanced', icon: Code2 }, { id: 'about', icon: Info }] as const).map(item => <button key={item.id} onClick={() => setPage(item.id)} className={cn('mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-ui-base', page === item.id ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover')}><item.icon className="size-4 shrink-0" />{labels[item.id]}</button>)}
      </nav>
      <fieldset disabled={saving} className="min-w-0 flex-1 overflow-y-auto p-6">
        <h2 className="mb-5 text-ui-lg font-medium">{labels[page]}</h2>
        {page === 'appearance' && <>
          <div className="mb-6 grid grid-cols-3 gap-3">{themeOptions.map(item => {
            const Icon = item.id === 'system' ? Monitor : item.dark ? Moon : Sun;
            return <button key={item.id} aria-pressed={state.settings.theme === item.id} className="theme-card overflow-hidden rounded-xl border border-border p-2 text-left hover:border-border-hover" onClick={() => void chooseTheme(item.id)}>
              <div className="mb-2 flex h-20 overflow-hidden rounded-lg border border-black/10" style={{ background: item.colors[0] }}><div className="preview-sidebar w-1/3 p-2" style={{ background: item.colors[1] }}><span style={{ background: item.colors[2] }} /><span /><span /></div><div className="flex flex-1 flex-col justify-between p-2"><div className="mt-2 h-1.5 w-2/3 rounded-full opacity-50" style={{ background: item.colors[2] }} /><div className="flex h-6 items-center justify-end rounded-md border p-1" style={{ borderColor: `${item.colors[2]}45` }}><span className="size-3 rounded" style={{ background: item.colors[2] }} /></div></div></div>
              <div className="flex items-center gap-1.5 px-1 text-ui-sm"><Icon className="size-3.5" />{L(item.label, item.description.split(' · ')[0])}{state.settings.theme === item.id && <Check className="ml-auto size-3.5" />}</div>
            </button>;
          })}</div>
          <p className="mb-6 text-ui-sm text-foreground-subtle">{L('明暗经典与四款精选配色，工作区和终端保持一致。点击立即保存并应用。', 'Classic light and dark, plus four curated palettes. Workspace and terminal stay in sync. Click to save and apply immediately.')}</p>
          <div className="rounded-xl border border-border bg-card"><SettingsRow label={t('fontSize')} description={t('fontNote')}><Select value={String(draft.fontSize)} onValueChange={value => setDraft({ ...draft, fontSize: Number(value) })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[12, 13, 14, 15, 16, 17, 18].map(value => <SelectItem key={value} value={String(value)}>{value} px</SelectItem>)}</SelectContent></Select></SettingsRow></div>
        </>}
        {page === 'general' && <div className="rounded-xl border border-border bg-card">
          <SettingsRow label={t('language')}><Select value={draft.language} onValueChange={value => setDraft({ ...draft, language: value as SettingsType['language'] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="zh-TW">繁體中文</SelectItem><SelectItem value="en-US">English</SelectItem></SelectContent></Select></SettingsRow>
          <SettingsRow label={t('sendKey')}><Select value={draft.sendKey} onValueChange={value => setDraft({ ...draft, sendKey: value as SettingsType['sendKey'] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="enter">{t('enterSend')}</SelectItem><SelectItem value="ctrl-enter">{t('ctrlSend')}</SelectItem></SelectContent></Select></SettingsRow>
          <SettingsRow label={t('startupTerminal')}><input type="checkbox" aria-label={t('startupTerminal')} checked={draft.terminalVisible} onChange={event => setDraft({ ...draft, terminalVisible: event.target.checked })} className="size-4 accent-foreground" /></SettingsRow>
          <SettingsRow label={L('选中文字自动复制', 'Copy selected text automatically')} description={L('鼠标选中聊天、预览或 TUI 文字后自动复制。输入框中的文字不受影响；终端原有鼠标操作保持可用。', 'Copy text selected in chat, preview, or the TUI. Editable fields are excluded; native terminal mouse controls stay available.')}><input type="checkbox" aria-label={L('选中文字自动复制', 'Copy selected text automatically')} checked={draft.copyOnSelect !== false} onChange={event => setDraft({ ...draft, copyOnSelect: event.target.checked })} className="size-4 accent-foreground" /></SettingsRow>
        </div>}
        {page === 'account' && <div className="space-y-5">
          <p className="text-ui-sm leading-6 text-foreground-subtle">{L('通过 Grok 官方引擎读取云端套餐与额度。左下角账号菜单可登录或切换 Build 账号；网页聊天账号独立管理。', 'Reads cloud allowance through the Grok engine. Sign in or switch Build accounts in the bottom-left menu; website accounts are managed separately.')}</p>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4"><div><p className="mb-1 text-ui-sm text-foreground-subtle">{L('当前订阅', 'Current subscription')}</p><p className="text-ui-xl font-semibold">{accountLoading && !account ? L('正在读取…', 'Loading…') : account?.subscriptionTier || L('暂未提供', 'Unavailable')}</p></div><Button variant="outline" size="sm" disabled={accountLoading} onClick={() => void refreshAccount()}><RefreshCw className={cn('size-3.5', accountLoading && 'animate-spin')} />{L('刷新', 'Refresh')}</Button></div>
            {account?.state === 'ready' && <div className="mt-6 space-y-4">
              <div><div className="mb-2 flex justify-between text-ui-sm"><span>{account.sharedPool ? L('跨 Grok 产品共享额度', 'Shared allowance across Grok products') : L('当前周期额度', 'Current period allowance')}</span><span className="font-medium">{account.remainingPercent === undefined ? L('未返回额度', 'Not provided') : `${account.remainingPercent.toFixed(1)}% ${L('剩余', 'remaining')}`}</span></div>{account.remainingPercent !== undefined && account.usedPercent !== undefined && <><div className="h-2 overflow-hidden rounded-full bg-surface-hover"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, account.usedPercent))}%` }} /></div><div className="mt-1 text-right text-ui-xs text-foreground-subtle">{L('已使用', 'Used')} {account.usedPercent.toFixed(1)}%</div></>}</div>
              {account.periodEnd && <div className="flex justify-between gap-4 text-ui-sm"><span className="text-foreground-subtle">{L('下次重置', 'Next reset')}</span><span>{new Date(account.periodEnd).toLocaleString(state.settings.language)}</span></div>}
              {([{ key: 'prepaidBalanceCents', label: L('预付余额', 'Prepaid balance') }, { key: 'onDemandUsedCents', label: L('按需用量', 'On-demand usage') }, { key: 'onDemandCapCents', label: L('按需上限', 'On-demand cap') }] as const).map(item => account[item.key] !== undefined && <div key={item.key} className="flex justify-between text-ui-sm"><span className="text-foreground-subtle">{item.label}</span><span>{new Intl.NumberFormat(state.settings.language, { style: 'currency', currency: 'USD' }).format(account[item.key]! / 100)}</span></div>)}
            </div>}
            {account?.error && <p role="status" className="mt-4 text-ui-sm leading-6 text-foreground-subtle">{account.error}</p>}
            {account?.checkedAt && <p className="mt-5 text-ui-xs text-foreground-subtlest">{L('更新于', 'Updated')} {new Date(account.checkedAt).toLocaleString(state.settings.language)}</p>}
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void run(window.grokdesk.openExternal('https://grok.com'))}>{L('打开 Grok 网页', 'Open Grok website')}</Button>{onOpenTerminal && <Button variant="ghost" onClick={() => { onOpenChange(false); onOpenTerminal(); }}>{L('打开原版 TUI', 'Open original TUI')}</Button>}</div>
        </div>}
        {page === 'advanced' && <div className="space-y-5">
          <p className="text-ui-sm leading-6 text-foreground-subtle">{L('当前会话选项直接来自 Grok。用户配置编辑器支持原版 TUI 的完整 TOML 设置，保留未知字段与注释。', 'Session options come directly from Grok. The user config editor supports the full TUI TOML configuration and preserves unknown fields and comments.')}</p>
          <section><h3 className="mb-2 text-ui-base font-medium">{L('当前会话', 'Current session')}</h3>{active?.configOptions.length ? <div className="rounded-xl border border-border bg-card">{active.configOptions.map(option => <SettingsRow key={option.id} label={option.name} description={option.category || option.id}>{option.type === 'select' && option.options.length ? <Select value={option.currentValue} disabled={['running', 'waiting', 'cancelling', 'connecting'].includes(active.phase)} onValueChange={value => void run(window.grokdesk.setConfig(active.id, option.id, value))}><SelectTrigger className="w-full"><SelectValue placeholder={L('选择…', 'Select…')} /></SelectTrigger><SelectContent>{option.options.map(value => <SelectItem key={value.value} value={value.value}>{value.name}</SelectItem>)}</SelectContent></Select> : <span className="text-ui-sm text-foreground-subtle">{option.currentValue || L('在原版 TUI 中设置', 'Configure in the original TUI')}</span>}</SettingsRow>)}</div> : <p className="text-ui-sm text-foreground-subtle">{L('打开一个已连接会话后显示引擎提供的模型、推理、权限等选项。', 'Open a connected session to view the model, reasoning, permission, and other options exposed by the engine.')}</p>}</section>
          <section><div className="mb-2 flex items-center justify-between"><h3 className="text-ui-base font-medium">{L('用户配置 · config.toml', 'User configuration · config.toml')}</h3><Button variant="ghost" size="sm" disabled={configLoading} onClick={() => void loadConfig()}><RefreshCw className={cn('size-3.5', configLoading && 'animate-spin')} />{configChanged ? L('放弃修改并重载', 'Discard and reload') : L('重新加载', 'Reload')}</Button></div>
            {config && <><p className="mb-2 break-all font-mono text-ui-xs text-foreground-subtle">{config.path}</p><textarea aria-label={L('Grok 完整 TOML 配置', 'Complete Grok TOML configuration')} className="settings-config-editor w-full rounded-lg border border-border bg-input p-3 font-mono text-ui-sm focus:border-brand focus:outline-none" spellCheck={false} value={configText} onChange={event => setConfigText(event.target.value)} /><p className="mt-2 text-ui-xs leading-5 text-foreground-subtle">{L('作用域：本机 Grok 用户配置（遵从 GROK_HOME）。保存校验 TOML 语法并备份原文件；字段含义由已安装的 Grok 版本解释。环境变量与受管策略可能覆盖这些值。保存后重新连接以加载。', 'Scope: local Grok user config (respects GROK_HOME). Saving validates TOML syntax and backs up the original; the installed Grok version interprets the fields. Environment variables and managed policies may override them. Reconnect to load changes.')}</p></>}
            {configLoading && !config && <p className="py-4 text-ui-sm text-foreground-subtle">{L('正在读取配置…', 'Loading configuration…')}</p>}
            {configError && <p role="alert" className="mt-2 text-ui-sm text-destructive">{configError}</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!configChanged || saving} onClick={() => void reconnect()}>{L('保存并重新连接', 'Save and reconnect')}</Button><Button variant="ghost" onClick={() => void run(window.grokdesk.openEngineConfig())}>{L('外部编辑器', 'External editor')}</Button><Button variant="ghost" onClick={() => void run(window.grokdesk.openExternal('https://docs.x.ai/build/settings/reference'))}>{L('完整设置参考', 'Full settings reference')}</Button></div>
          </section>
          {onOpenTerminal && <div className="rounded-lg border border-border bg-surface p-3 text-ui-sm"><p className="mb-2 leading-6 text-foreground-subtle">{L('主题、快捷键、插件管理及交互式菜单也可在原版 TUI 输入 /settings 或 / 使用。', 'Use /settings or / in the original TUI for themes, keybindings, plugin management, and interactive menus.')}</p><Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenTerminal(); }}>{L('打开原版设置入口', 'Open native settings')}</Button></div>}
        </div>}
        {page === 'engine' && <div className="space-y-5"><div><label className="mb-2 block text-ui-base font-medium" htmlFor="engine-path">{t('enginePath')}</label><Input id="engine-path" size="lg" value={draft.enginePath} placeholder={engineExecutable} onChange={event => setDraft({ ...draft, enginePath: event.target.value })} /><p className="mt-2 text-ui-sm leading-relaxed text-foreground-subtle">{t('enginePathNote')}</p></div><div className="rounded-xl border border-border bg-card p-4 text-ui-sm"><div className="mb-2 flex items-center gap-2"><span className={`status-dot phase-${state.engine.state === 'ready' ? 'ready' : 'error'}`} />{t(state.engine.state === 'ready' ? 'ready' : state.engine.state === 'missing' || state.engine.state === 'error' ? 'error' : 'connecting')}</div><div className="break-all font-mono text-foreground-subtle">{state.engine.path ?? '—'}</div>{state.engine.version && <div className="mt-2 text-foreground-subtle">{state.engine.version}</div>}{state.engine.error && <div className="mt-3 text-destructive">{state.engine.error}</div>}</div><Button variant="outline" onClick={() => void reconnect()}>{t(pathChanged ? 'saveReconnect' : 'reconnect')}</Button></div>}
        {page === 'about' && <div className="space-y-5"><div className="flex items-center gap-3"><img src="./grok-mobile.png" className="size-12 rounded-xl" alt="GrokDesk" /><div><div className="text-ui-lg font-medium">GrokDesk</div><div className="text-ui-sm text-foreground-subtle">{window.grokdesk.version} · {platformName} · Electron</div></div></div><p className="text-ui-base leading-7 text-foreground-subtle">{t('aboutText')}</p><div className="flex flex-col items-start gap-2"><Button variant="link" onClick={() => void run(window.grokdesk.openExternal('https://docs.x.ai/build/overview'))}>{t('docs')}</Button><Button variant="link" onClick={() => void run(window.grokdesk.openExternal('https://github.com/zai-org/ZCode'))}>{t('source')}</Button></div><p className="break-all font-mono text-ui-xs text-foreground-subtlest">ZCode · Apache-2.0<br />872ad960de7ec172591f7e1952f7849229f94521</p></div>}
      </fieldset>
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3"><Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>{t('cancel')}</Button><Button disabled={saving} onClick={() => void save()}>{t('save')}</Button></div>
  </DialogContent></Dialog>;
}
