import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { applicationDataDirectory } from './platform.mjs';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { GROK_HOME, isGrokUrl } from './grok-web-policy.mjs';

const extensionSource = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-extension');
const MAX_BODY = 3_000_000;
const text = (value, limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : '';
const clientKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const safeImage = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };
export function normalizeBrowserSnapshot(input) {
  if (!input || !isGrokUrl(input.url)) throw new Error('浏览器快照必须来自 Grok 官网');
  const nickname = text(input.account?.nickname, 120).trim();
  return {
    url: input.url, title: text(input.title, 200) || 'Grok', loading: input.loading === true,
    account: nickname ? { nickname, avatarUrl: safeImage(input.account?.avatarUrl), syncedAt: new Date().toISOString() } : undefined,
    messages: (Array.isArray(input.messages) ? input.messages : []).slice(-500).filter(item => item && ['user', 'assistant'].includes(item.role)).map((item, i) => ({ id: text(item.id, 100) || String(i), role: item.role, content: text(item.content, 200_000) })),
    history: (Array.isArray(input.history) ? input.history : []).slice(0, 200).filter(item => item && isGrokUrl(item.url)).map(item => ({ title: text(item.title, 200) || 'Grok', url: item.url })),
    capabilities: { send: input.capabilities?.send === true, stop: input.capabilities?.stop === true, attachments: input.capabilities?.attachments === true },
  };
}

/** Only authenticated extension traffic is accepted. No browser credentials are read. */
export function createBrowserBridge({ dataPath, emit = () => {}, port = 43127, dependencies = {} } = {}) {
  const io = dependencies;
  let electron;
  const native = async () => electron ||= await import('electron');
  const openExternal = io.openExternal || (async url => (await native()).shell.openExternal(url));
  const openPath = io.openPath || (async filename => { const error = await (await native()).shell.openPath(filename); if (error) throw new Error(error); });
  const directory = dataPath || applicationDataDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const configPath = path.join(directory, 'browser-bridge.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  if (!/^[a-f0-9]{64}$/.test(config?.token || '')) config = { token: randomBytes(32).toString('hex') };
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const setupPath = path.join(directory, 'browser-extension');
  fs.mkdirSync(setupPath, { recursive: true });
  const tabs = new Map(), pending = new Map(), polls = new Map();
  let activeProfileId = '', visible = false, disposed = false, error, boundPort = port, setupRequestedAt;
  const current = () => tabs.get(activeProfileId);
  const isLive = tab => tab && Date.now() - tab.seen < 35_000;
  const status = () => {
    const tab = current(), connected = isLive(tab);
    return { url: tab?.state.url || GROK_HOME, title: tab?.state.title || 'Grok', loading: connected && !!tab.state.loading,
      canGoBack: connected, canGoForward: connected, visible, error, connection: error ? 'error' : connected ? 'connected' : 'disconnected',
      profiles: [...tabs].filter(([, value]) => isLive(value)).map(([id, value]) => ({ id, label: value.state.account?.nickname || value.state.title || 'Grok' })),
      activeProfileId, setupPath, setupRequestedAt, account: connected ? tab.state.account : undefined,
      messages: tab?.state.messages || [], history: connected ? tab.state.history : [], capabilities: connected ? tab.state.capabilities : { send: false, stop: false, attachments: false } };
  };
  const publish = () => { if (!disposed) emit({ type: 'web', state: status() }); };
  const respond = (response, code, data) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); } };
  const flush = clientId => {
    const poll = polls.get(clientId); if (!poll) return;
    const commands = [...pending.values()].filter(item => item.clientId === clientId && !item.delivered).map(item => { item.delivered = true; return item.command; });
    if (!commands.length) return;
    clearTimeout(poll.timer); polls.delete(clientId); respond(poll.response, 200, { commands });
  };
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (request.headers.host !== `127.0.0.1:${boundPort}` || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) return respond(response, 403, { error: 'Forbidden origin' });
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'POST'); return respond(response, 200, {}); }
    const authorization = request.headers.authorization || '';
    const expected = `Bearer ${config.token}`;
    const providedBytes = Buffer.from(authorization), expectedBytes = Buffer.from(expected);
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return respond(response, 401, { error: 'Unauthorized' });
    if (request.method !== 'POST') return respond(response, 405, { error: 'POST required' });
    try {
      let size = 0; const parts = [];
      for await (const part of request) { size += part.length; if (size > MAX_BODY) { respond(response, 413, { error: 'Payload too large' }); request.destroy(); return; } parts.push(part); }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!clientKey(body.clientId)) throw new Error('Invalid client');
      if (request.url === '/snapshot') {
        if (!Number.isInteger(body.tabId) || body.tabId < 0) throw new Error('Invalid tab');
        const id = `${body.clientId}:${body.tabId}`;
        tabs.set(id, { clientId: body.clientId, tabId: body.tabId, seen: Date.now(), state: normalizeBrowserSnapshot(body.state) });
        if (!activeProfileId) activeProfileId = id;
        error = undefined; publish(); respond(response, 200, { ok: true });
      } else if (request.url === '/closed') {
        tabs.delete(`${body.clientId}:${body.tabId}`); publish(); respond(response, 200, { ok: true });
      } else if (request.url === '/result') {
        const item = pending.get(body.id);
        if (item?.clientId === body.clientId) { clearTimeout(item.timer); pending.delete(body.id); body.ok === true ? item.resolve() : item.reject(new Error(text(body.error, 1000) || '浏览器操作未完成')); }
        respond(response, 200, { ok: true });
      } else if (request.url === '/poll') {
        const prior = polls.get(body.clientId); if (prior) { clearTimeout(prior.timer); respond(prior.response, 200, { commands: [] }); }
        const poll = { response, timer: setTimeout(() => { if (polls.get(body.clientId) === poll) polls.delete(body.clientId); respond(response, 200, { commands: [] }); }, 20_000) };
        polls.set(body.clientId, poll); response.on('close', () => { clearTimeout(poll.timer); if (polls.get(body.clientId) === poll) polls.delete(body.clientId); }); flush(body.clientId);
      } else respond(response, 404, { error: 'Not found' });
    } catch (reason) { respond(response, 400, { error: text(reason.message) }); }
  });
  const ready = new Promise(resolve => {
    server.once('error', reason => { error = `本机浏览器连接无法启动：${reason.code || reason.message}。请关闭重复运行的 GrokDesk 后重试。`; publish(); resolve(false); });
    server.listen(port, '127.0.0.1', () => {
      boundPort = server.address().port;
      try {
        for (const file of fs.readdirSync(extensionSource)) fs.copyFileSync(path.join(extensionSource, file), path.join(setupPath, file));
        fs.writeFileSync(path.join(setupPath, 'config.js'), `globalThis.GROKDESK_CONFIG = ${JSON.stringify({ endpoint: `http://127.0.0.1:${boundPort}`, token: config.token })};\n`, { mode: 0o600 });
      } catch (reason) { error = '浏览器扩展准备失败：' + reason.message; }
      publish(); resolve(!error);
    });
  });
  const command = (action, payload = {}, tab = current()) => {
    if (!isLive(tab)) return Promise.reject(new Error('请先连接浏览器扩展，并在本机浏览器打开 Grok。'));
    if ([...pending.values()].some(item => item.command.tabId === tab.tabId && item.clientId === tab.clientId && item.command.action === 'send')) return Promise.reject(new Error('正在等待官网确认发送，请稍候。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器未确认此操作。请检查官网后再试，避免重复发送。')); }, 90_000);
      pending.set(id, { clientId: tab.clientId, command: { id, tabId: tab.tabId, expectedUrl: tab.state.url, expectedAccount: tab.state.account?.nickname, action, ...payload }, timer, resolve, reject, delivered: false }); flush(tab.clientId);
    });
  };
  let liveBefore = false;
  const heartbeat = setInterval(() => { const live = !!isLive(current()); if (liveBefore !== live) { liveBefore = live; publish(); } }, 5000); heartbeat.unref();
  async function setup() { await ready; if (error) throw new Error(error); setupRequestedAt = Date.now(); publish(); await openPath(setupPath); return status(); }
  return {
    status, ready, setup, mount(input) { visible = input?.visible === true; return status(); },
    async action(action, argument, target) {
      if (target && (target.profileId !== activeProfileId || target.url !== current()?.state.url || target.accountNickname !== undefined && target.accountNickname !== current()?.state.account?.nickname)) throw new Error('浏览器目标已改变，请等待同步后重试。');
      if (action === 'setup') return setup();
      if (['external', 'login', 'usage', 'add-account'].includes(action)) {
        await openExternal(isGrokUrl(current()?.state.url) && action === 'external' ? current().state.url : GROK_HOME);
        if (action === 'usage') emit({ type: 'notice', message: '请在本机浏览器的 Grok 账号菜单查看官方用量。' });
      } else if (action === 'switch-account') {
        if (!isLive(tabs.get(argument))) throw new Error('此浏览器标签页已断开连接');
        if ([...pending.values()].some(item => item.command.action === 'send')) throw new Error('正在等待官网确认发送，请稍候切换标签页。');
        await command('focus', {}, tabs.get(argument)); activeProfileId = argument;
      } else if (action === 'open-chat') {
        if (!isGrokUrl(argument)) throw new Error('只能打开 Grok 官网会话'); await command('navigate', { url: argument });
      } else if (['home', 'new-chat'].includes(action)) {
        if (isLive(current())) await command('navigate', { url: GROK_HOME }); else await openExternal(GROK_HOME);
      } else if (['back', 'forward', 'reload', 'stop'].includes(action)) await command(action);
      else throw new Error('不支持的浏览器操作');
      publish(); return status();
    },
    async send(prompt, files = [], target) {
      if (target && (target.profileId !== activeProfileId || target.url !== current()?.state.url || target.accountNickname !== undefined && target.accountNickname !== current()?.state.account?.nickname)) throw new Error('浏览器会话已改变，草稿已保留，请等待同步后重试。');
      if (typeof prompt !== 'string' || prompt.length > 200_000 || !Array.isArray(files) || files.length > 10 || (!prompt.trim() && !files.length)) throw new Error('请输入消息，单次最多添加 10 个附件。');
      let total = 0;
      const attachments = files.map(file => {
        if (!file || typeof file.name !== 'string' || !(file.data instanceof Uint8Array)) throw new Error('附件格式无效');
        total += file.data.length; if (total > 20 * 1024 * 1024) throw new Error('单次附件总大小不可超过 20 MB；更大的文件请在官网上传。');
        return { name: path.basename(file.name).slice(0, 200), mime: text(file.mime, 100), base64: Buffer.from(file.data).toString('base64') };
      });
      if (!current()?.state.capabilities.send) throw new Error('官网输入框尚未就绪，请在浏览器中完成登录或验证。');
      await command('send', { text: prompt, attachments }); return status();
    },
    dispose() {
      disposed = true; clearInterval(heartbeat);
      for (const poll of polls.values()) { clearTimeout(poll.timer); respond(poll.response, 200, { commands: [] }); } polls.clear();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('GrokDesk 已关闭')); } pending.clear();
      server.close(); server.closeAllConnections(); tabs.clear();
    },
  };
}
