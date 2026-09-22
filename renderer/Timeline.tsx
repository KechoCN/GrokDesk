import { memo, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, Check, ChevronRight, Copy, Image, LoaderCircle, SquareTerminal } from 'lucide-react';
import type { Conversation, Message } from '../shared/api';
import { Button } from './components/ui/button';
import { useText } from './i18n';
import { cn } from './components/lib/utils';
import type { RunAction } from './useDesk';
import { OutputBlock } from './OutputBlock';

const MessageBody = memo(function MessageBody({ item, run }: { item: Message; run: RunAction }) {
  const t = useText();
  const [copied, setCopied] = useState(false);
  function copy() { void run(window.grokdesk.writeClipboard(item.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); })); }
  const markdown = <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    pre: OutputBlock,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href} onClick={event => { event.preventDefault(); void run(window.grokdesk.openExternal(href)); }}>{children}</a> : <span title={href}>{children}</span>,
    img: ({ src, alt }) => typeof src === 'string' && /^https?:\/\//i.test(src) ? <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-ui-sm text-foreground-subtle hover:bg-hover" title={src} onClick={() => void run(window.grokdesk.openExternal(src))}><Image className="size-3.5" />{alt || t('viewImage')}</button> : <span>{alt}</span>,
  }}>{item.content}</Markdown></div>;
  if (item.role === 'tool' || item.role === 'thought') return <details className="tool-row group my-2 rounded-lg border border-border/70 text-ui-sm" open={item.status === 'in_progress'}>
    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-foreground-subtle"><ChevronRight className="detail-chevron size-3 shrink-0" />{item.role === 'tool' ? <SquareTerminal className="size-3.5" /> : <span className="size-1.5 rounded-full bg-foreground-subtlest" />}<span className="min-w-0 flex-1 truncate">{item.title || t(item.role === 'tool' ? 'tools' : 'thought')}</span>{item.status && <span className="shrink-0 text-ui-xs">{item.status}</span>}</summary>
    <div className="max-h-96 overflow-auto border-t border-border px-3 py-3">{item.role === 'tool' ? <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-relaxed">{item.content}</pre> : markdown}</div>
  </details>;
  return <article className={cn('message group mb-7', item.role === 'user' && 'message-user', item.role === 'system' && 'text-foreground-subtle')}>
    <div className="mb-2 flex items-center justify-between text-ui-sm text-foreground-subtle"><span className="font-medium">{item.role === 'user' ? t('you') : item.role === 'assistant' ? t('assistant') : 'GrokDesk'}</span><Button variant="ghost" size="icon-xs" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={copy} aria-label={t('copy')} title={t(copied ? 'copied' : 'copy')}>{copied ? <Check /> : <Copy />}</Button></div>
    {item.role === 'user' ? <div className="whitespace-pre-wrap break-words rounded-xl bg-surface px-4 py-3 text-ui-base leading-7">{item.content}</div> : markdown}
    {!!item.attachments?.some(attachment => attachment.kind === 'image' && attachment.preview) && <div className="mt-3 flex flex-wrap gap-3">{item.attachments.filter(attachment => attachment.kind === 'image' && attachment.preview).map(attachment => <img key={attachment.id} src={attachment.preview} alt={attachment.name} title={attachment.name} className="max-h-52 max-w-[min(100%,280px)] rounded-lg border border-border object-contain" />)}</div>}
  </article>;
}, (previous, next) => previous.run === next.run && previous.item.id === next.item.id && previous.item.role === next.item.role && previous.item.content === next.item.content && previous.item.title === next.item.title && previous.item.status === next.item.status);

export function Timeline({ conversation, run }: { conversation: Conversation; run: RunAction }) {
  const t = useText();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (follow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { follow.current = true; setScrolled(false); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [conversation.id]);
  return <div className="relative min-h-0 min-w-0 flex-1">
    <div ref={scroller} className="h-full overflow-y-auto px-6 pt-7" onScroll={() => { const node = scroller.current!; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolled(!follow.current); }}>
      <div ref={content} className="mx-auto w-full max-w-4xl pb-6">{conversation.messages.filter(item => !(item.role === 'system' && (item.planEntries || item.title === '计划' || item.title === 'Plan'))).map(item => <MessageBody item={item} run={run} key={item.id} />)}
        {['running', 'waiting', 'cancelling'].includes(conversation.phase) && <div role="status" className="flex items-center gap-2 pb-3 text-ui-sm text-foreground-subtle"><LoaderCircle className="size-3.5 animate-spin" /><span>{t(conversation.phase as 'running' | 'waiting' | 'cancelling')}…</span></div>}
      </div>
    </div>
    {scrolled && <Button variant="outline" size="icon-md" className="absolute bottom-3 left-1/2 rounded-full bg-popover shadow-sm" title={t('jumpLatest')} aria-label={t('jumpLatest')} onClick={() => { follow.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown /></Button>}
  </div>;
}
