importScripts('config.js');
const { endpoint, token } = globalThis.GROKDESK_CONFIG;
let polling = false, connected = false;
const client = chrome.storage.local.get('clientId').then(async value => { if (value.clientId) return value.clientId; const id = crypto.randomUUID(); await chrome.storage.local.set({ clientId: id }); return id; });
const validUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && ['grok.com', 'www.grok.com'].includes(url.hostname) && !url.port && !url.username && !url.password; } catch { return false; } };
async function post(route, data) {
  const response = await fetch(endpoint + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ ...data, clientId: await client }), signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error('连接未就绪（' + response.status + '）');
  return response.json();
}
async function execute(command) {
  try {
    const tab = await chrome.tabs.get(command.tabId);
    if (!validUrl(tab.url)) throw new Error('目标标签页不再是 Grok 官网');
    if (tab.url !== command.expectedUrl) throw new Error('官网已切换会话，请等待 GrokDesk 同步后重试。');
    if (command.action === 'navigate') {
      if (!validUrl(command.url)) throw new Error('只允许 Grok 官网地址');
      await chrome.tabs.update(tab.id, { url: command.url });
    } else if (command.action === 'focus') { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    else if (command.action === 'reload') await chrome.tabs.reload(tab.id);
    else if (command.action === 'back') await chrome.tabs.goBack(tab.id);
    else if (command.action === 'forward') await chrome.tabs.goForward(tab.id);
    else {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'grokdesk:command', command });
      if (!result?.ok) throw new Error(result?.error || '请刷新 Grok 网页后重试');
    }
    await post('/result', { id: command.id, ok: true });
  } catch (error) { await post('/result', { id: command.id, ok: false, error: error.message }).catch(() => {}); }
}
async function start() {
  if (polling) return; polling = true;
  try {
    while (true) {
      // A 20-second long poll plus an extension API call keeps the MV3 worker responsive.
      await chrome.storage.local.get('clientId');
      const response = await post('/poll', {}); connected = true;
      await Promise.all((response.commands || []).map(execute));
    }
  } catch { connected = false; }
  finally { polling = false; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'grokdesk:snapshot' && sender.tab && sender.frameId === 0 && validUrl(sender.url)) {
    post('/snapshot', { tabId: sender.tab.id, state: message.state }).then(() => { connected = true; reply({ ok: true }); }, () => { connected = false; reply({ ok: false }); }); void start(); return true;
  }
  if (message?.type === 'grokdesk:status' && !sender.tab) { reply({ connected }); void start(); }
});
chrome.tabs.onRemoved.addListener(tabId => { void post('/closed', { tabId }).catch(() => {}); });
chrome.alarms.onAlarm.addListener(() => void start());
chrome.runtime.onStartup.addListener(() => void start());
chrome.runtime.onInstalled.addListener(async () => { await chrome.alarms.create('grokdesk-connect', { periodInMinutes: 0.5 }); void start(); });
void chrome.alarms.create('grokdesk-connect', { periodInMinutes: 0.5 });
void start();
