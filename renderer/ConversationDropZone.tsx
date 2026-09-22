import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from './components/lib/utils';
import { useText } from './i18n';
import { errorMessage, type RunAction } from './useDesk';

const carriesFiles = (transfer: DataTransfer | null) => Array.from(transfer?.types ?? []).includes('Files');

export function ConversationDropZone({ conversationId, disabled = false, run, notify, children, className }: {
  conversationId: string; disabled?: boolean; run: RunAction; notify: (text: string) => void; children: ReactNode; className?: string;
}) {
  const t = useText();
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const preventNavigation = (event: DragEvent) => { if (carriesFiles(event.dataTransfer)) event.preventDefault(); };
    const reset = () => { depth.current = 0; setDragging(false); };
    // Chromium otherwise navigates to files dropped beside the composer.
    document.addEventListener('dragover', preventNavigation);
    document.addEventListener('drop', preventNavigation);
    document.addEventListener('drop', reset);
    document.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragover', preventNavigation);
      document.removeEventListener('drop', preventNavigation);
      document.removeEventListener('drop', reset);
      document.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);
  useEffect(() => { depth.current = 0; setDragging(false); }, [conversationId, disabled]);

  return <div data-conversation-drop-zone={conversationId} className={cn('relative', className)}
    onDragEnter={event => { if (carriesFiles(event.dataTransfer)) { event.preventDefault(); depth.current++; if (!disabled) setDragging(true); } }}
    onDragOver={event => { if (carriesFiles(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; } }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={event => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
      if (disabled) return;
      try {
        const paths = [...new Set(Array.from(event.dataTransfer.files).map(file => window.grokdesk.getFilePath(file)).filter(Boolean))];
        if (paths.length) void run(window.grokdesk.attachFiles(conversationId, paths));
        else notify('无法读取拖入的文件，请使用附件按钮选择本地文件。');
      } catch (error) { notify(errorMessage(error)); }
    }}>
    {children}
    {dragging && <div role="status" className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-background/85 backdrop-blur-sm"><div className="flex items-center gap-3 rounded-xl border border-border bg-popover px-6 py-4 text-ui-base text-foreground shadow-xl"><Paperclip className="size-5 text-brand" />{t('drop')}</div></div>}
  </div>;
}
