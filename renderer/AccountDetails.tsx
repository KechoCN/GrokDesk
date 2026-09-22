import type { AccountSnapshot } from '../shared/api';

export function AccountDetails({ account, language }: { account: AccountSnapshot | null; language: string }) {
  const en = language === 'en-US';
  const L = (zh: string, english: string) => en ? english : zh;
  if (!account) return <p className="py-4 text-ui-sm text-foreground-subtle">{L('正在读取云端额度…', 'Loading cloud allowance…')}</p>;
  return <div data-account-details className="space-y-3 text-ui-sm">
    <div className="flex items-baseline justify-between gap-4"><span className="font-medium">{account.subscriptionTier || L('云端订阅', 'Cloud subscription')}</span><span className="font-semibold tabular-nums">{account.remainingPercent === undefined ? '—' : `${account.remainingPercent.toFixed(1)}%`} {L('剩余', 'remaining')}</span></div>
    {account.state === 'ready' && <>
      <p className="text-foreground-subtle">{account.sharedPool ? L('Grok 产品共享额度', 'Allowance shared across Grok products') : L('当前订阅周期', 'Current subscription period')}{account.periodType?.includes('WEEK') ? L(' · 每周', ' · Weekly') : account.periodType?.includes('MONTH') ? L(' · 每月', ' · Monthly') : ''}</p>
      {account.usedPercent !== undefined && <><div className="h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-label={L('云端已用额度', 'Cloud allowance used')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, account.usedPercent)}><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, account.usedPercent)}%` }} /></div><div className="flex justify-between text-foreground-subtle"><span>{L('已使用', 'Used')} {account.usedPercent.toFixed(1)}%</span><span>{L('未使用', 'Unused')} {account.remainingPercent?.toFixed(1)}%</span></div></>}
      {account.periodStart && <div className="flex justify-between gap-4"><span className="text-foreground-subtle">{L('周期开始', 'Period start')}</span><span>{new Date(account.periodStart).toLocaleString(language)}</span></div>}
      {account.periodEnd && <div className="flex justify-between gap-4"><span className="text-foreground-subtle">{L('额度重置', 'Resets')}</span><span>{new Date(account.periodEnd).toLocaleString(language)}</span></div>}
    </>}
    {account.error && <p role="status" className="leading-6 text-warning">{account.error}</p>}
  </div>;
}
