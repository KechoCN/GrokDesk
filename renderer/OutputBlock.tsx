import { Children, isValidElement, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Check, Code2, Copy, FileText } from 'lucide-react';
import { useText } from './i18n';
import './output-block.css';

// Markdown supplies a single code element inside pre, including one renderer-added LF.
// Soft wrapping is CSS-only so copying never introduces display line breaks.
export function OutputBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const t = useText();
  const code = Children.toArray(children).find(child => isValidElement<{ children?: ReactNode; className?: string }>(child) && child.type === 'code');
  const props = isValidElement<{ children?: ReactNode; className?: string }>(code) ? code.props : undefined;
  const value = String(props?.children ?? '').replace(/\n$/, '');
  const language = props?.className?.match(/(?:^|\s)language-(\S+)/)?.[1] || '';
  const plain = !language || /^(text|txt|plaintext|plain|md|markdown)$/i.test(language);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { setCopiedValue(null); setFailed(false); clearTimeout(timer.current); }, [value]);
  const copied = copiedValue === value;
  async function copy() {
    try {
      await window.grokdesk.writeClipboard(value);
      if (!mounted.current) return;
      setFailed(false); setCopiedValue(value); clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedValue(null), 1800);
    } catch {
      if (mounted.current) setFailed(true);
    }
  }
  return <div className="output-block" data-kind={plain ? 'text' : 'code'}>
    <div className="output-block-header">
      <span className="output-block-label" title={language || t('textOutput')}>{plain ? <FileText size={14} /> : <Code2 size={14} />}<span>{plain ? t('textOutput') : language}</span></span>
      <button type="button" className="output-block-copy" aria-label={t(plain ? 'copyText' : 'copyCode')} title={t(copied ? 'copied' : plain ? 'copyText' : 'copyCode')} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}<span aria-live="polite">{t(copied ? 'copied' : 'copy')}</span></button>
    </div>
    {failed && <p className="output-block-error" role="alert">{t('copyFailed')}</p>}
    <div className="output-block-body"><pre><code className={props?.className}>{value}</code></pre></div>
  </div>;
}
