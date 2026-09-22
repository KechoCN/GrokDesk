import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Copy, ExternalLink, Globe, History, LoaderCircle, Paperclip, Plus, Puzzle, RefreshCw, Square, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OutputBlock } from './OutputBlock';
import type { WebChatState } from '../shared/api';
import './web-chat.css';

export function WebChat({ active, suspended = false, language = 'zh-CN', notify = () => {} }: {
  active: boolean; suspended?: boolean; language?: 'zh-CN'|'zh-TW'|'en-US'; notify?: (message: string) => void;
}) {
  const [state, setState] = useState<WebChatState | null>(null);
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem('grokdesk-chat-draft') || ''; } catch { return ''; } });
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false), [setupOpen, setSetupOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [copied, setCopied] = useState('');
  const input = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null), following = useRef(true), sendLock = useRef(false);
  const notifyRef = useRef(notify); notifyRef.current = notify;
  const stateRef = useRef(state); stateRef.current = state;
  const L = (zh: string, english: string) => language === 'en-US' ? english : zh;
  const connected = state?.connection === 'connected';
  const action = useCallback(async (name: Parameters<typeof window.grokdesk.webAction>[0], argument?: string) => {
    const snapshot = stateRef.current;
    const target = snapshot?.connection === 'connected' && ['stop', 'new-chat', 'home', 'reload', 'back', 'forward', 'open-chat'].includes(name) ? { profileId: snapshot.activeProfileId, url: snapshot.url, accountNickname: snapshot.account?.nickname } : undefined;
    try { setState(await window.grokdesk.webAction(name, argument, target)); } catch (error) { notifyRef.current(error instanceof Error ? error.message : String(error)); }
  }, []);
  useEffect(() => { try { localStorage.setItem('grokdesk-chat-draft', draft); } catch {} }, [draft]);
  useEffect(() => {
    let live = true;
    window.grokdesk.webStatus().then(value => { if (live) setState(value); }).catch(error => notifyRef.current(String(error)));
    const off = window.grokdesk.onEvent(event => { if (event.type === 'web') setState(event.state); });
    return () => { live = false; off(); };
  }, []);
  useEffect(() => { if (state?.setupRequestedAt) setSetupOpen(true); }, [state?.setupRequestedAt]);
  useEffect(() => { if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [state?.messages]);
  async function setup() { setSetupOpen(true); try { setState(await window.grokdesk.webSetup()); } catch (error) { notifyRef.current(String(error)); } }
  async function copy(value: string, id: string) { try { await window.grokdesk.writeClipboard(value); setCopied(id); setTimeout(() => setCopied(''), 1800); } catch (error) { notifyRef.current(String(error)); } }
  async function send() {
    if (sendLock.current || state?.loading || !connected || !state?.capabilities?.send || (!draft.trim() && !files.length)) return;
    sendLock.current = true; setSending(true);
    const target = { profileId: state.activeProfileId, url: state.url, accountNickname: state.account?.nickname };
    try {
      const attachments = await Promise.all(files.map(async file => ({ name: file.name, mime: file.type, data: new Uint8Array(await file.arrayBuffer()) })));
      setState(await window.grokdesk.webSend(draft, attachments, target)); setDraft(''); setFiles([]); following.current = true;
    } catch (error) { notifyRef.current(error instanceof Error ? error.message : String(error)); }
    finally { sendLock.current = false; setSending(false); }
  }
  function addFiles(next: File[]) {
    if (sendLock.current) return;
    const combined = [...files, ...next];
    if (combined.length > 10 || combined.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { notifyRef.current(L('最多添加 10 个附件，总大小不超过 20 MB。', 'Add up to 10 files, totaling no more than 20 MB.')); return; }
    setFiles(combined);
  }
  return <section className="web-chat" hidden={!active} aria-label={L('Grok 聊天', 'Grok chat')}>
    <header className="web-chat-toolbar">
      <span className={`web-connection ${connected ? 'connected' : ''}`}><span/>{connected ? L('已连接本机浏览器', 'Browser connected') : L('连接你的浏览器', 'Connect your browser')}</span>
      <div className="web-chat-toolbar-actions">
        {state && (state.profiles.length > 1 || state.profiles.length > 0 && !state.profiles.some(profile => profile.id === state.activeProfileId)) && <select disabled={sending} aria-label={L('浏览器标签页', 'Browser tab')} value={state.activeProfileId} onChange={event => void action('switch-account', event.target.value)}>{!state.profiles.some(profile => profile.id === state.activeProfileId) && <option value={state.activeProfileId}>{L('选择浏览器标签页', 'Select a browser tab')}</option>}{state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select>}
        <button title={L('会话记录', 'Chat history')} aria-label={L('会话记录', 'Chat history')} onClick={() => setHistoryOpen(!historyOpen)} disabled={!connected || sending}><History size={16}/></button>
        <button title={L('新聊天', 'New chat')} aria-label={L('新聊天', 'New chat')} onClick={() => void action('new-chat')} disabled={sending || state?.loading}><Plus size={17}/></button>
        <button title={L('在浏览器中继续', 'Continue in browser')} onClick={() => void action('external')}><ExternalLink size={15}/><span>{L('在浏览器中继续', 'Open browser')}</span></button>
      </div>
    </header>
    {state?.error && <div className="web-chat-error" role="alert">{state.error}</div>}
    {connected && !state?.capabilities?.send && !state?.loading && <div className="web-chat-error" role="status">{L('当前官网页面的聊天输入框不可用。请新建聊天，或在浏览器中完成登录与验证。', 'Chat is unavailable on the current website page. Start a new chat, or complete sign-in and verification in your browser.')}</div>}
    {historyOpen && <aside className="web-chat-history"><div><strong>{L('官网会话', 'Website chats')}</strong><button onClick={() => setHistoryOpen(false)} aria-label={L('关闭记录', 'Close history')}><X size={15}/></button></div>{state?.history?.length ? state.history.map(item => <button key={item.url} disabled={sending} onClick={() => { setHistoryOpen(false); void action('open-chat', item.url); }}>{item.title}</button>) : <p>{L('官网当前未显示会话记录。在浏览器展开侧栏后自动同步。', 'Open the website sidebar in your browser to sync visible chats.')}</p>}</aside>}
    <div className="web-chat-scroll" ref={scroller} onScroll={() => { const element = scroller.current!; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120; }}>
      {!state?.messages?.length ? <div className="web-chat-welcome"><Globe size={35} strokeWidth={1.2}/><h1>{L('今天想聊些什么？', 'What’s on your mind?')}</h1><p>{connected ? L('使用浏览器中的 Grok 账号，直接在这里开始。', 'Start here with the Grok account in your browser.') : L('连接已登录的 Chrome 或 Edge，消息与官网保持同步。', 'Connect your signed-in Chrome or Edge browser to sync with Grok.')}</p>{!connected && <button className="web-primary" onClick={() => void setup()}><Puzzle size={16}/>{L('设置浏览器连接', 'Set up browser connection')}</button>}</div> : <div className="web-chat-messages">{state.messages.map(message => <article className={`web-message ${message.role}`} key={message.id}><div className="web-message-byline"><span>{message.role === 'user' ? L('你', 'You') : 'Grok'}</span><button aria-label={L('复制消息', 'Copy message')} onClick={() => void copy(message.content, message.id)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button></div><div className="markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ pre: OutputBlock, a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href} onClick={event => { event.preventDefault(); void window.grokdesk.openExternal(href).catch(error => notifyRef.current(String(error))); }}>{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt}</span> }}>{message.content}</Markdown></div></article>)}{state.loading && <div className="web-chat-working"><LoaderCircle size={14}/>{L('Grok 正在回复…', 'Grok is responding…')}</div>}</div>}
      {setupOpen && <div className="web-setup"><div><strong>{L('连接 Chrome / Edge', 'Connect Chrome / Edge')}</strong><button aria-label={L('收起设置', 'Close setup')} onClick={() => setSetupOpen(false)}><X size={15}/></button></div><ol><li>{L('在浏览器地址栏打开 chrome://extensions 或 edge://extensions。', 'Open chrome://extensions or edge://extensions in your browser.')}</li><li>{L('开启开发者模式，选择“加载已解压的扩展程序”，选择下方文件夹。', 'Enable Developer mode, choose “Load unpacked”, then select the folder below.')}</li><li>{L('打开 Grok 官网并登录；已打开的页面请刷新一次。', 'Open Grok and sign in; refresh any already open Grok page.')}</li></ol><button className="web-setup-path" title={state?.setupPath} onClick={() => state?.setupPath && void copy(state.setupPath, 'path')}><span>{state?.setupPath || L('正在准备扩展…', 'Preparing extension…')}</span>{copied === 'path' ? <Check size={14}/> : <Copy size={14}/>}</button><div className="web-setup-actions"><button onClick={() => void setup()}>{L('打开扩展文件夹', 'Open extension folder')}</button><button onClick={() => void action('external')}>{L('打开 Grok 官网', 'Open Grok')}</button></div><p>{L('扩展仅连接 Grok 页面。语音、屏幕共享、模型选择等操作可在本机浏览器继续；官网控件变化时，这里会提示暂不可用。', 'The extension connects only to Grok. Continue in your browser for voice, screen sharing, model selection, or website controls unavailable here.')}</p></div>}
    </div>
    <div className="web-chat-composer-wrap">
      {!connected && !!state?.messages?.length && <p className="web-offline">{L('浏览器已断开，当前显示上次同步的内容。', 'Browser disconnected. Showing the last synced messages.')}</p>}
      <div className="web-chat-composer" onDragOver={event => { if (state?.capabilities?.attachments) event.preventDefault(); }} onDrop={event => { if (!state?.capabilities?.attachments) return; event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
        {!!files.length && <div className="web-attachments">{files.map((file, i) => <span key={i}><Paperclip size={12}/>{file.name}<button disabled={sending} aria-label={L('移除附件', 'Remove file')} onClick={() => setFiles(files.filter((_, index) => i !== index))}><X size={12}/></button></span>)}</div>}
        <textarea aria-label={L('聊天消息', 'Chat message')} placeholder={L('给 Grok 发送消息', 'Message Grok')} value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} onPaste={event => { if (state?.capabilities?.attachments && event.clipboardData.files.length) { event.preventDefault(); addFiles([...event.clipboardData.files]); } }}/>
        <div className="web-composer-actions"><input ref={input} type="file" multiple hidden onChange={event => { addFiles([...(event.target.files || [])]); event.target.value = ''; }}/><button disabled={!connected || sending || !state?.capabilities?.attachments} title={L('添加附件', 'Add files')} aria-label={L('添加附件', 'Add files')} onClick={() => input.current?.click()}><Plus size={20}/></button><span>{connected ? 'Grok' : L('草稿会保留在这里', 'Your draft stays here')}</span>{state?.loading ? <button className="web-send" disabled={!connected || !state.capabilities?.stop || sending} aria-label={L('停止回复', 'Stop response')} onClick={() => void action('stop')}><Square size={15}/></button> : <button className="web-send" aria-label={L('发送消息', 'Send message')} disabled={!connected || !state?.capabilities?.send || sending || (!draft.trim() && !files.length)} onClick={() => void send()}>{sending ? <LoaderCircle size={17}/> : <ArrowUp size={19}/>}</button>}</div>
      </div>
      <div className="web-chat-context-bar"><button onClick={() => void action('external')}><Globe size={14}/>{L('本机浏览器', 'Local browser')}<ChevronDown size={12}/></button><button onClick={() => void setup()}><Puzzle size={14}/>{L('浏览器扩展', 'Browser extension')}</button><button className="web-context-end" disabled={!connected || sending || state?.loading} title={L('刷新官网连接', 'Reload website')} aria-label={L('刷新官网连接', 'Reload website')} onClick={() => void action('reload')}><RefreshCw size={13}/></button></div>
    </div>
  </section>;
}
