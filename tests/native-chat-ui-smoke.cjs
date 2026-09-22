// Isolated renderer fixture: no browser, account, network request or real Grok task.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-native-chat-ui-')));
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = code => win.webContents.executeJavaScript(code);
async function until(code, message) {
  for (let index = 0; index < 100; index++) { if (await script(code)) return; await pause(50); }
  throw new Error(message);
}
async function click(label) {
  await script(`document.querySelector('.web-chat button[aria-label=${JSON.stringify(label)}]').click()`);
  await pause(70);
}
async function setDraft(value) {
  await script(`(() => { const field = document.querySelector('.web-chat textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles:true })); })()`);
  await pause(60);
}
async function setWeb(value) { await script(`window.grokdeskTest.setWeb(${JSON.stringify(value)})`); await pause(70); }
async function capture(name) {
  const directory = path.join(root, 'artifacts', 'verification');
  fs.mkdirSync(directory, { recursive: true });
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
  await pause(100);
  fs.writeFileSync(path.join(directory, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
async function bounds() {
  const result = await script(`(() => { const chat = document.querySelector('.web-chat').getBoundingClientRect(), composer = document.querySelector('.web-chat-composer').getBoundingClientRect(), transcript = document.querySelector('.web-chat-scroll').getBoundingClientRect(); return { overflow:document.documentElement.scrollWidth > innerWidth, composer:{ left:composer.left, right:composer.right, top:composer.top, bottom:composer.bottom }, chat:{ left:chat.left, right:chat.right, bottom:chat.bottom }, transcriptBottom:transcript.bottom, transcriptHeight:transcript.height }; })()`);
  assert.equal(result.overflow, false, 'Native chat overflowed the window');
  assert.ok(result.composer.left >= result.chat.left && result.composer.right <= result.chat.right, 'Chat composer escaped its pane');
  assert.ok(result.composer.bottom <= result.chat.bottom && result.transcriptBottom <= result.composer.top, 'Chat transcript overlapped its composer');
  assert.ok(result.transcriptHeight > 100, 'Chat transcript became unusably short');
}

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (...args) => { const details = args[1]; if (typeof details === 'object' && details.level === 'error') errors.push(details.message); });
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await win.webContents.insertCSS('*, *::before, *::after { transition:none !important; animation:none !important; }');
    await until(`!!document.querySelector('textarea.composer-text')`, 'Build composer did not mount');
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button => button.textContent.includes('聊天')).click()`);
    await until(`!!document.querySelector('.web-chat:not([hidden]) textarea')`, 'Native chat did not mount');
    assert.equal(await script(`document.querySelectorAll('webview, iframe, .web-chat-host').length`), 0, 'Chat still embedded a website surface');
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'webMount').length`), 0, 'Chat still invoked the embedded browser mount API');
    await setDraft('连接后继续发送的草稿');
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="发送消息"]').disabled`), true, 'Disconnected chat enabled sending');
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="添加附件"]').disabled`), true, 'Disconnected chat enabled browser attachment actions');
    await script(`Array.from(document.querySelectorAll('.web-chat button')).find(button => button.textContent === '设置浏览器连接').click()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webSetup')`, 'Browser connection setup did not dispatch');
    await until(`document.querySelector('.web-setup-path')?.textContent.includes('browser-extension')`, 'Browser setup did not show its extension directory');
    await click('收起设置');

    const avatarUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#6b7363"/><text x="32" y="43" fill="white" font-size="34" font-family="sans-serif" text-anchor="middle">李</text></svg>');
    const messages = [
      { id: 'question', role: 'user', content: '帮我整理今天的学习任务。' },
      { id: 'response', role: 'assistant', content: '可以从这三件事开始：\n\n1. 回顾昨天的课堂笔记。\n2. 完成今天的练习，并记录不确定的问题。\n3. 留出十分钟复盘。\n\n你想先从哪一项开始？' },
    ];
    await setWeb({ connection: 'connected', error: '', loading: false, capabilities: { send: true, stop: false, attachments: true }, account: { nickname: '科舍 李', avatarUrl, syncedAt: new Date().toISOString() }, profiles: [{ id: 'browser-1', label: '科舍 李 · Grok' }, { id: 'browser-2', label: '另一个 Grok 标签页' }], activeProfileId: 'browser-1', messages, history: [{ title: '今天的学习计划', url: 'https://grok.com/c/learning-fixture' }, { title: '写作灵感', url: 'https://grok.com/c/writing-fixture' }] });
    await script(`window.grokdesk.updateSettings({ theme:'light' })`);
    await until(`document.querySelectorAll('.web-message').length === 2`, 'Website messages did not appear in native chat');
    await until(`document.querySelector('.account-nickname')?.textContent === '科舍 李'`, 'Website nickname did not sync to the sidebar');
    await until(`document.querySelector('.account-avatar img')?.naturalWidth === 64`, 'Website avatar did not sync to the sidebar');
    assert.equal(await script(`document.querySelector('.account-sync-dot').classList.contains('connected')`), true);
    assert.equal(await script(`document.querySelector('.web-chat textarea').value`), '连接后继续发送的草稿', 'Connecting lost the unsent draft');
    await bounds();
    await capture('native-chat-connected-light.png');

    await script(`document.querySelector('.web-message.assistant button[aria-label="复制消息"]').click()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'writeClipboard' && call.text === ${JSON.stringify(messages[1].content)})`, 'Copy did not use the synced assistant message');
    await click('发送消息');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webSend' && call.text === '连接后继续发送的草稿')`, 'Send did not reach the browser bridge');
    await until(`document.querySelector('.web-chat textarea').value === ''`, 'Successful send did not clear the draft');
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'send').length`), 0, 'Native chat accidentally submitted a Build task');
    assert.equal(await script(`localStorage.getItem('grokdesk-chat-draft')`), '');

    await setWeb({ loading: true, capabilities: { send: false, stop: true, attachments: true } });
    await until(`!!document.querySelector('.web-chat button[aria-label="停止回复"]')`, 'Streaming chat did not offer stop');
    await click('停止回复');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webAction' && call.action === 'stop')`, 'Stop did not reach the browser bridge');
    await setWeb({ connection: 'disconnected', loading: true, capabilities: { send: false, stop: false, attachments: false } });
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="停止回复"]').disabled`), true, 'Disconnected chat offered a working stop control');
    await setWeb({ connection: 'connected', loading: false, capabilities: { send: true, stop: false, attachments: true } });

    await script(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['Reference attachment bytes'], '参考资料.txt', { type:'text/plain' })); const field = document.querySelector('.web-chat input[type="file"]'); field.files = transfer.files; field.dispatchEvent(new Event('change', { bubbles:true })); })()`);
    await until(`document.querySelector('.web-attachments')?.textContent.includes('参考资料.txt')`, 'Selected chat attachment did not appear');
    await setDraft('请结合这个附件继续。');
    await click('发送消息');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webSend' && call.files[0]?.name === '参考资料.txt' && call.files[0]?.size === 26)`, 'Attachment bytes did not reach the browser bridge');
    await until(`!document.querySelector('.web-attachments')`, 'Sent attachments remained staged');
    await click('会话记录');
    await until(`document.querySelector('.web-chat-history')?.textContent.includes('今天的学习计划')`, 'Synced browser history did not appear');
    await script(`Array.from(document.querySelectorAll('.web-chat-history > button')).find(button => button.textContent === '今天的学习计划').click()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webAction' && call.action === 'open-chat' && call.target === 'https://grok.com/c/learning-fixture')`, 'History selection did not open the selected official chat');
    await click('新聊天');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webAction' && call.action === 'new-chat')`, 'New chat did not use the browser bridge');
    await script(`(() => { const select = document.querySelector('.web-chat select[aria-label="浏览器标签页"]'); select.value = 'browser-2'; select.dispatchEvent(new Event('change', { bubbles:true })); })()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'webAction' && call.action === 'switch-account' && call.target === 'browser-2')`, 'Browser tab selection did not dispatch');

    await script(`document.querySelector('.account-help').dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, pointerType:'mouse', ctrlKey:false }))`);
    await until(`!!document.querySelector('[role="menu"]')`, 'Sidebar help menu did not open');
    await capture('native-chat-account-help.png');
    await script(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
    await pause(100);
    await setDraft('断线后保留的下一条消息');
    await setWeb({ connection: 'disconnected', loading: false, capabilities: { send: false, stop: false, attachments: false } });
    await script(`window.grokdesk.updateSettings({ theme:'midnight' })`);
    win.setContentSize(960, 640); await pause(250);
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="发送消息"]').disabled`), true);
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="添加附件"]').disabled`), true);
    assert.equal(await script(`document.querySelector('.web-chat button[aria-label="会话记录"]').disabled`), true);
    assert.equal(await script(`document.querySelector('.account-nickname').textContent`), '科舍 李', 'Disconnect erased the last synced identity');
    assert.equal(await script(`document.querySelector('.account-sync-dot').classList.contains('connected')`), false);
    assert.equal(await script(`document.querySelector('.web-chat textarea').value`), '断线后保留的下一条消息');
    assert.equal(await script(`document.querySelectorAll('.web-message').length`), 2);
    assert.equal(await script(`getComputedStyle(document.querySelector('.web-chat-composer')).backgroundColor`), 'rgb(52, 65, 92)');
    await bounds();
    await capture('native-chat-offline-dark-compact.png');
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'webMount').length`), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Native chat UI smoke passed: no embedded browser, send/stop/attachments/history/tab actions, copied messages, synced account identity, preserved offline drafts and compact themed layout.');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (win && !win.isDestroyed()) { try { await capture('native-chat-ui-failure.png'); } catch {} win.destroy(); } app.exit(1); }
});
