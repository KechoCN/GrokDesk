import { useEffect, useState } from 'react';
import type { AppSnapshot, AuthState } from '../shared/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { errorMessage } from './useDesk';

export function AccountLogin({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppSnapshot }) {
  const [auth, setAuth] = useState<AuthState>({ state: 'idle' }), [error, setError] = useState(''), [code, setCode] = useState(''), [pending, setPending] = useState(false);
  const L = (zh: string, en: string) => state.settings.language === 'en-US' ? en : zh;
  const working = state.conversations.some(c => ['running', 'waiting', 'cancelling', 'connecting'].includes(c.phase));
  const signing = ['starting', 'waiting'].includes(auth.state);
  useEffect(() => {
    if (!open) return;
    let mounted = true; setError('');
    const dispose = window.grokdesk.onEvent(event => { if (event.type === 'auth') setAuth(event.state); });
    window.grokdesk.authStatus().then(value => { if (mounted) setAuth(value); }).catch(reason => { if (mounted) setError(errorMessage(reason)); });
    return () => { mounted = false; dispose(); };
  }, [open]);
  async function action(operation: () => Promise<AuthState | void>) { setPending(true); setError(''); try { const value = await operation(); if (value) setAuth(value); } catch (reason) { setError(errorMessage(reason)); } finally { setPending(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{L('登录 / 切换 Build 账号', 'Sign in / switch Build account')}</DialogTitle><DialogDescription>{L('使用 Grok 官方授权。完成后重新连接引擎，后续请求使用新账号。已有历史、草稿和附件保留。', 'Uses official Grok authorization. The engine reconnects after sign-in. Future requests use this account; history, drafts and attachments are kept.')}</DialogDescription></DialogHeader>
    {auth.profile && <div className="rounded-lg bg-surface p-3 text-ui-sm"><p className="font-medium">{[auth.profile.firstName, auth.profile.lastName].filter(Boolean).join(' ') || L('当前 Build 账号', 'Current Build account')}</p><p className="mt-1 text-foreground-subtle">{auth.profile.email || auth.profile.methodId || '—'}</p>{auth.profile.teamName && <p>{auth.profile.teamName}</p>}</div>}
    {working && <p className="text-ui-sm text-warning">{L('请先等待所有任务完成或停止，再切换 Build 账号。', 'Finish or stop running tasks before switching Build accounts.')}</p>}
    {signing && <div className="space-y-3 text-ui-sm"><p>{L('请在已打开的 Grok 授权窗口中完成登录。', 'Complete sign-in in the Grok authorization window.')}</p>{auth.code && <p className="rounded-lg bg-surface p-3 font-mono text-lg tracking-wider">{auth.code}</p>}{auth.mode === 'command' && <div className="flex gap-2"><Input aria-label={L('授权码', 'Authorization code')} placeholder={L('粘贴官方授权码', 'Paste authorization code')} value={code} onChange={event => setCode(event.target.value)} /><Button disabled={pending || !code.trim()} onClick={() => void action(() => window.grokdesk.authSubmitCode(code.trim()))}>{L('提交', 'Submit')}</Button></div>}<div className="flex gap-2"><Button variant="outline" disabled={pending || !auth.url} onClick={() => void action(() => window.grokdesk.authExternal())}>{L('在系统浏览器中授权', 'Authorize in browser')}</Button><Button variant="ghost" disabled={pending} onClick={() => void action(() => window.grokdesk.authCancel())}>{L('取消登录', 'Cancel sign-in')}</Button></div></div>}
    {auth.state === 'success' && <p role="status" className="text-ui-sm text-success">{L('登录已完成。', 'Signed in successfully.')}</p>}
    {(error || auth.error) && <p role="alert" className="text-ui-sm text-destructive">{error || auth.error}</p>}
    <p className="text-ui-xs leading-5 text-foreground-subtle">{L('网页聊天账号独立保存在聊天模式中，可在其账号选择器新增或切换。Build 账号同时用于本机原版 Grok。', 'Website chat accounts are stored separately and can be added or switched in Chat mode. The Build account is also used by the local Grok CLI.')}</p>
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>{L('关闭', 'Close')}</Button><Button disabled={pending || signing || working || state.engine.state !== 'ready'} onClick={() => void action(() => window.grokdesk.authStart())}>{pending ? L('正在启动…', 'Starting…') : auth.profile ? L('登录另一个账号', 'Sign in to another account') : L('登录 Grok', 'Sign in to Grok')}</Button></div>
  </DialogContent></Dialog>;
}
