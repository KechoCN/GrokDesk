import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SquareTerminal, X } from 'lucide-react';
import type { AppEvent, Conversation } from '../shared/api';
import { Button } from './components/ui/button';
import { useText } from './i18n';
import { errorMessage } from './useDesk';
import { platform, terminalClipboardAction, terminalCopyShortcut, terminalFontFamily, terminalPasteShortcut } from './platform';

function terminalTheme(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: color('--terminal-background', dark ? '#242629' : '#f8f8f8'),
    foreground: color('--terminal-foreground', dark ? '#eceef1' : '#262626'),
    cursor: color('--terminal-cursor', dark ? '#ffffff' : '#0d0d0d'),
    selectionBackground: color('--terminal-selection', '#0b7fff55'),
  };
}

export function TerminalPanel({ conversation, dark, height = 260, copyOnSelect = true, onClose, notify }: { conversation: Conversation; dark: boolean; height?: number; copyOnSelect?: boolean; onClose: () => void; notify: (message: string) => void }) {
  const t = useText();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerm | null>(null);
  const activePhase = useRef(conversation.phase);
  const copySelection = useRef(copyOnSelect);
  const [error, setError] = useState<string | null>(null);
  activePhase.current = conversation.phase;
  copySelection.current = copyOnSelect;
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let initialized = false;
    let sequence = -1;
    const buffered: Extract<AppEvent, { type: 'terminal' }>[] = [];
    const term = new XTerm({ cursorBlink: true, convertEol: false, fontSize: 13, fontFamily: terminalFontFamily, scrollback: 5000, allowProposedApi: false, theme: terminalTheme(dark) });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    // Terminal rendering must not cache missing glyphs before the webfont loads.
    // Load the complete offline CJK family when opening a Linux terminal, then
    // discard any cached fallback glyphs. Latin keeps its preferred monospace face.
    if (platform === 'linux') {
      const fonts = [...document.fonts].filter(font => font.family.replaceAll(/["']/g, '') === 'GrokDesk Noto Sans SC');
      void Promise.all(fonts.map(font => font.load())).then(() => {
        if (!disposed) { term.clearTextureAtlas(); term.refresh(0, term.rows - 1); }
      }).catch(reason => { if (!disposed) notify(errorMessage(reason)); });
    }
    // Grok's own mouse selection can copy via OSC 52 instead of xterm's
    // selection event (https://docs.x.ai/build/cli/terminal-support). Accept
    // writes after a real terminal gesture, never clipboard queries or replay.
    let clipboardGestureUntil = 0;
    const gesture = (event: MouseEvent) => { if (event.isTrusted && event.button === 0) clipboardGestureUntil = Date.now() + 2_000; };
    const element = host.current;
    element.addEventListener('mouseup', gesture, true);
    const oscClipboard = term.parser.registerOscHandler(52, data => {
      if (!copySelection.current || !initialized || Date.now() > clipboardGestureUntil) return true;
      const separator = data.indexOf(';');
      if (separator < 0) return true;
      const encoded = data.slice(separator + 1);
      if (!encoded || encoded === '?' || encoded.length > 2_666_668) return true;
      try {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text) { clipboardGestureUntil = 0; void window.grokdesk.writeClipboard(text).catch(reason => notify(errorMessage(reason))); }
      } catch { /* Ignore malformed terminal clipboard payloads. */ }
      return true;
    });
    // xterm emits this after mouse selection finishes. Do not replace its mouse
    // handlers: native TUI clicks, wheel input and Shift selection keep working.
    const selection = term.onSelectionChange(() => {
      const text = term.getSelection();
      if (copySelection.current && text) void window.grokdesk.writeClipboard(text).catch(reason => notify(errorMessage(reason)));
    });
    const receive = (event: Extract<AppEvent, { type: 'terminal' }>) => {
      if (event.sequence <= sequence || disposed) return;
      sequence = event.sequence;
      term.write(event.data);
    };
    const unsubscribe = window.grokdesk.onEvent(event => {
      if (event.type !== 'terminal' || event.conversationId !== conversation.id) return;
      if (!initialized) buffered.push(event); else receive(event);
    });
    const report = (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); };
    window.grokdesk.terminalSnapshot(conversation.id).then(snapshot => {
      if (disposed) return;
      term.reset();
      term.write(snapshot.data);
      sequence = snapshot.sequence;
      initialized = true;
      for (const event of buffered) receive(event);
      buffered.length = 0;
      fit.fit();
      void window.grokdesk.terminalResize(conversation.id, term.cols, term.rows).catch(report);
    }).catch(report);
    const input = term.onData(data => {
      // The main process owns input arbitration and recognizes automatic VT replies.
      // Filtering bytes in the renderer also drops DSR replies and TUI approvals.
      if (data === '\x03' && ['running', 'waiting', 'cancelling'].includes(activePhase.current)) {
        void window.grokdesk.cancel(conversation.id).catch(report); return;
      }
      void window.grokdesk.terminalInput(conversation.id, data).catch(report);
    });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (disposed) return; fit.fit(); if (initialized) void window.grokdesk.terminalResize(conversation.id, term.cols, term.rows).catch(report); });
    });
    observer.observe(host.current);
    term.attachCustomKeyEventHandler(event => {
      const action = terminalClipboardAction(event);
      if (action === 'copy') { event.preventDefault(); if (term.hasSelection()) void window.grokdesk.writeClipboard(term.getSelection()).catch(reason => notify(errorMessage(reason))); return false; }
      if (action === 'paste') { event.preventDefault(); void window.grokdesk.readClipboard().then(text => { if (!disposed) term.paste(text); }).catch(reason => notify(errorMessage(reason))); return false; }
      return true;
    });
    return () => { disposed = true; unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame); element.removeEventListener('mouseup', gesture, true); oscClipboard.dispose(); selection.dispose(); input.dispose(); term.dispose(); terminal.current = null; };
  }, [conversation.id]);
  useEffect(() => {
    const update = () => { if (terminal.current) terminal.current.options.theme = terminalTheme(dark); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [dark]);
  return <section className="terminal-panel flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background" style={{ height }} aria-label={t('terminal')} title={`${t('copy')}: ${terminalCopyShortcut} · ${t('paste')}: ${terminalPasteShortcut} · ${t('stop')}: Ctrl+C`}>
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-ui-sm"><SquareTerminal className="size-3.5" /><span>{t('terminal')}</span><span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">{['running', 'waiting', 'cancelling'].includes(conversation.phase) ? t('terminalBusy') : t('terminalHint')}</span><Button variant="ghost" size="icon-xs" aria-label={t('close')} onClick={onClose}><X /></Button></div>
    {error ? <div role="alert" className="p-3 text-ui-sm text-destructive">{error}</div> : null}
    <div ref={host} className="terminal-xterm-shell min-h-0 flex-1 px-2 py-1" onClick={() => terminal.current?.focus()} />
  </section>;
}
