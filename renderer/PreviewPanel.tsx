import { useEffect, useRef, useState } from 'react';
import { File, FolderOpen, Image, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Conversation, PreviewDocument, PreviewFile } from '../shared/api';
import { Button } from './components/ui/button';
import { cn } from './components/lib/utils';
import { errorMessage } from './useDesk';

export function PreviewPanel({ conversation, language, onClose, notify, requestedFile }: {
  conversation?: Conversation; language: 'zh-CN' | 'zh-TW' | 'en-US'; onClose: () => void; notify: (message: string) => void; requestedFile?: { path?: string; sequence: number };
}) {
  const L = (zh: string, en: string) => language === 'en-US' ? en : zh;
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [reload, setReload] = useState(0);
  const previousId = useRef(conversation?.id);
  const consumedRequest = useRef<number | undefined>(undefined);
  const attachmentSignature = conversation?.attachments.map(file => file.id).join(',') || '';
  useEffect(() => {
    let cancelled = false;
    if (!conversation) { setFiles([]); setSelected(''); return; }
    if (previousId.current !== conversation.id) { setSelected(''); setDocument(null); setQuery(''); previousId.current = conversation.id; }
    setLoading(true); setError('');
    window.grokdesk.previewFiles(conversation.id).then(result => {
      if (cancelled) return;
      setFiles(result.files); setTruncated(!!result.truncated);
      const requested = requestedFile?.sequence !== consumedRequest.current ? requestedFile?.path : undefined;
      consumedRequest.current = requestedFile?.sequence;
      const normalized = requested?.replace(/\\/g, '/').toLowerCase();
      const match = normalized && result.files.find(file => file.path.replace(/\\/g, '/').toLowerCase() === normalized || file.name.replace(/\\/g, '/').toLowerCase() === normalized);
      setSelected(current => match ? match.path : requested || (result.files.some(file => file.path === current) ? current : result.files[0]?.path || ''));
    }).catch(reason => { if (!cancelled) { setFiles([]); setError(errorMessage(reason)); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversation?.id, conversation?.phase, attachmentSignature, reload, requestedFile?.sequence]);
  useEffect(() => {
    let cancelled = false;
    setDocument(null); setShowSource(false);
    if (!conversation || !selected) { setReading(false); return; }
    setReading(true); setError('');
    window.grokdesk.readPreview(conversation.id, selected).then(result => { if (!cancelled) setDocument(result); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); }).finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [conversation?.id, selected, reload, conversation?.phase, requestedFile?.sequence]);
  const filtered = files.filter(file => `${file.name} ${file.path}`.toLowerCase().includes(query.toLowerCase()));
  const markdown = document?.kind === 'text' && /\.(md|markdown|mdown)$/i.test(document.name);
  return <aside className="preview-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background" aria-label={L('文件预览', 'File preview')}>
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-header px-3"><FolderOpen className="size-4 text-foreground-subtle" /><span className="min-w-0 flex-1 text-ui-sm font-medium">{L('文件预览', 'File preview')}</span><Button variant="ghost" size="icon-xs" disabled={!conversation || loading} title={L('刷新文件', 'Refresh files')} aria-label={L('刷新文件', 'Refresh files')} onClick={() => setReload(value => value + 1)}><RefreshCw className={cn(loading && 'animate-spin')} /></Button><Button variant="ghost" size="icon-xs" aria-label={L('关闭预览', 'Close preview')} onClick={onClose}><X /></Button></div>
    {conversation ? <>
      <div className="shrink-0 border-b border-border p-2"><div className="flex items-center gap-2 rounded-md border border-input-border bg-input px-2"><Search className="size-3.5 shrink-0 text-foreground-subtle" /><input aria-label={L('筛选文件', 'Filter files')} placeholder={L('搜索工作区文件…', 'Search workspace files…')} value={query} onChange={event => setQuery(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-ui-sm outline-none" /></div></div>
      <div className="preview-file-list shrink-0 overflow-y-auto border-b border-border p-1" role="listbox" aria-label={L('工作区文件', 'Workspace files')}>
        {filtered.map(file => <button key={file.path} role="option" aria-selected={file.path === selected} title={file.path} className={cn('flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm', file.path === selected ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover')} onClick={() => setSelected(file.path)}>{/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(file.name) ? <Image className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}<span className="truncate">{file.name}</span></button>)}
        {!loading && !filtered.length && <p className="p-3 text-ui-sm text-foreground-subtle">{query ? L('没有匹配的文件', 'No matching files') : L('工作区暂无可预览文件', 'No previewable workspace files')}</p>}
      </div>
      {truncated && <p className="shrink-0 px-3 py-1 text-ui-xs text-foreground-subtle">{L('文件列表已截断；可在文件夹中查看更多。', 'File list truncated. Open the folder to see more.')}</p>}
      {document && <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border px-3 py-1"><span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle" title={document.path}>{document.name}</span>{markdown && <Button variant="ghost" size="sm" aria-pressed={showSource} onClick={() => setShowSource(value => !value)}>{showSource ? L('预览', 'Preview') : L('源码', 'Source')}</Button>}<span className="text-ui-xs text-foreground-subtlest">{document.size < 1024 ? `${document.size} B` : `${(document.size / 1024).toFixed(1)} KB`}</span></div>}
      <div className="file-preview-content min-h-0 flex-1 overflow-auto p-4">
        {(loading || reading) && <div role="status" className="flex items-center justify-center gap-2 py-6 text-ui-sm text-foreground-subtle"><LoaderCircle className="size-4 animate-spin" />{L('正在读取…', 'Loading…')}</div>}
        {error && <p role="alert" className="break-words text-ui-sm text-destructive">{error}</p>}
        {!reading && document?.kind === 'image' && document.dataUrl && <img src={document.dataUrl} alt={document.name} className="mx-auto max-h-full max-w-full rounded-md object-contain" />}
        {!reading && document?.kind === 'text' && (markdown && !showSource ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) void window.grokdesk.openExternal(href).catch(reason => notify(errorMessage(reason))); }}>{children}</a>, img: ({ alt }) => <span className="text-foreground-subtle">[{alt || L('图片', 'Image')}]</span> }}>{document.content || ''}</ReactMarkdown></div> : <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-6">{document.content}</pre>)}
        {!reading && document?.kind === 'unsupported' && <div className="py-6 text-center text-ui-sm text-foreground-subtle"><File className="mx-auto mb-3 size-8" /><p>{L('此文件格式暂不支持内嵌预览。', 'This file format cannot be previewed inline.')}</p><Button variant="outline" size="sm" className="mt-4" onClick={() => void window.grokdesk.openFolder(conversation.id).catch(reason => notify(errorMessage(reason)))}><FolderOpen />{L('打开文件夹', 'Open folder')}</Button></div>}
        {document?.truncated && <p className="mt-4 text-ui-xs text-foreground-subtle">{L('文件较大，仅显示开头部分。', 'Large file: showing the beginning only.')}</p>}
      </div>
      <div className="shrink-0 truncate border-t border-border px-3 py-2 text-ui-xs text-foreground-subtlest" title={conversation.cwd}>{conversation.cwd}</div>
    </> : <div className="p-5 text-ui-sm leading-6 text-foreground-subtle">{L('选择工作区会话后预览文件。', 'Select a workspace conversation to preview files.')}</div>}
  </aside>;
}
