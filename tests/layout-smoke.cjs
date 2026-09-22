// Fixture-only UI checks: no real Grok account, network, or user workspace is used.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-layout-')));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const script = code => win.webContents.executeJavaScript(code);
async function until(code, message) {
  for (let i = 0; i < 80; i++) { if (await script(code)) return; await pause(50); }
  throw new Error(message);
}
async function click(label) { await script(`document.querySelector('button[aria-label="${label}"]').click()`); await pause(100); }
async function selectPreview() {
  await script(`(() => { const text = document.querySelector('.file-preview-content p'); text.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, button:0, clientX:10, clientY:10 })); const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); text.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, button:0, clientX:120, clientY:10 })); })()`);
  await pause(100);
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (...args) => { const details = args[1]; if (typeof details === 'object' && details.level === 'error') errors.push(details.message); });
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await win.webContents.insertCSS('*, *::before, *::after { transition:none !important; animation:none !important; }');
    await until(`!!document.querySelector('textarea.composer-text')`, 'Composer did not mount');
    await click('文件预览');
    await until(`document.querySelector('.file-preview-content h1')?.textContent === 'Preview fixture'`, 'Markdown preview did not render');
    await selectPreview();
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').at(-1)?.text`), 'Selectable preview text', 'Selection was not automatically copied');
    const copyCount = await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`);
    await script(`window.grokdesk.updateSettings({ copyOnSelect:false })`);
    await pause(100); await selectPreview();
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`), copyCount, 'Disabled copy on select still copied');
    await script(`window.grokdesk.updateSettings({ copyOnSelect:true })`);
    await pause(100);
    await script(`(() => { const field = document.querySelector('textarea.composer-text'); field.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, button:0, clientX:10 })); field.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, button:0, clientX:100 })); })()`);
    await pause(100);
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`), copyCount, 'Editable input unexpectedly copied display selection');
    await script(`document.querySelector('.preview-file-list button[title="image.png"]').click()`);
    await until(`!!document.querySelector('.file-preview-content img[src^="data:image/png"]')`, 'Image preview did not render');
    await click('原版 TUI');
    await until(`!!document.querySelector('.terminal-panel .xterm')`, 'Terminal did not mount');
    await script(`window.grokdeskTest.emitTerminal('Grok terminal selection fixture\\r\\n')`);
    const oscBefore = await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`);
    const oscData = '\x1b]52;c;' + Buffer.from('原生终端选中内容').toString('base64') + '\x07';
    await script(`window.grokdeskTest.emitTerminal(${JSON.stringify(oscData)})`); await pause(100);
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`), oscBefore, 'Unsolicited terminal output overwrote the clipboard');
    async function terminalGesture() {
      const bounds = await script(`(() => { const r = document.querySelector('.terminal-xterm-shell').getBoundingClientRect(); return { x:Math.round(r.x + 15), y:Math.round(r.y + 10) }; })()`);
      win.webContents.sendInputEvent({ type:'mouseDown', ...bounds, button:'left', clickCount:1 });
      win.webContents.sendInputEvent({ type:'mouseUp', ...bounds, button:'left', clickCount:1 });
      await pause(50);
    }
    await terminalGesture();
    await script(`window.grokdeskTest.emitTerminal(${JSON.stringify(oscData)})`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'writeClipboard' && call.text === '原生终端选中内容')`, 'Native TUI OSC 52 clipboard write was not handled');
    await script(`window.grokdesk.updateSettings({ copyOnSelect:false })`); await pause(100);
    const oscDisabled = await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`);
    await terminalGesture();
    await script(`window.grokdeskTest.emitTerminal(${JSON.stringify(oscData)})`); await pause(100);
    assert.equal(await script(`window.grokdeskTest.calls().filter(call => call.name === 'writeClipboard').length`), oscDisabled, 'Disabled native TUI copy still wrote to the clipboard');
    await script(`window.grokdesk.updateSettings({ copyOnSelect:true })`); await pause(100);
    for (const [label, key, direction] of [['导航栏宽度', 'ArrowRight', 1], ['预览栏宽度', 'ArrowLeft', 1], ['终端高度', 'ArrowUp', 1]]) {
      const before = await script(`Number(document.querySelector('[role="separator"][aria-label="${label}"]').getAttribute('aria-valuenow'))`);
      await script(`document.querySelector('[role="separator"][aria-label="${label}"]').dispatchEvent(new KeyboardEvent('keydown', { key:'${key}', bubbles:true }))`);
      await pause(100);
      assert.equal(await script(`Number(document.querySelector('[role="separator"][aria-label="${label}"]').getAttribute('aria-valuenow'))`), before + 16 * direction, `${label} keyboard resize failed`);
    }
    const beforeDrag = await script(`Number(document.querySelector('[aria-label="终端高度"]').getAttribute('aria-valuenow'))`);
    const handle = await script(`(() => { const r = document.querySelector('[aria-label="终端高度"]').getBoundingClientRect(); return { x:Math.round(r.x + r.width / 2), y:Math.round(r.y + r.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type:'mouseMove', ...handle });
    win.webContents.sendInputEvent({ type:'mouseDown', ...handle, button:'left', clickCount:1 });
    win.webContents.sendInputEvent({ type:'mouseMove', x:handle.x, y:handle.y - 38, button:'left' });
    win.webContents.sendInputEvent({ type:'mouseUp', x:handle.x, y:handle.y - 38, button:'left', clickCount:1 });
    await pause(150);
    assert.equal(await script(`Number(document.querySelector('[aria-label="终端高度"]').getAttribute('aria-valuenow'))`), beforeDrag + 38, 'Terminal pointer resize failed');
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button => button.textContent.includes('聊天')).click()`);
    await until(`!!document.querySelector('.web-chat:not([hidden])')`, 'Native chat did not appear');
    assert.equal(await script(`window.grokdeskTest.calls().some(call => call.name === 'webMount' && call.visible)`), false, 'Chat attempted to embed a browser');
    await click('设置');
    await until(`!!document.querySelector('[role="dialog"]')`, 'Settings did not open over native chat');
    await script(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent === '取消').click()`);
    await until(`!document.querySelector('[role="dialog"]')`, 'Settings dialog did not close');
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button => button.textContent === 'Build').click()`);
    await pause(100);
    await script(`window.grokdesk.updateSettings({ theme:'midnight' })`);
    win.setContentSize(960, 640); await pause(300);
    assert.equal(await script(`document.documentElement.scrollWidth <= innerWidth`), true, 'Layout overflowed the supported minimum width');
    const controls = await script(`Array.from(document.querySelectorAll('header button.window-control')).every(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= document.querySelector('.desk-main-panel').getBoundingClientRect().right; })`);
    assert.equal(controls, true, 'Window controls escaped the main panel at 960px');
    const out = path.join(root, 'artifacts', 'verification'); fs.mkdirSync(out, { recursive:true });
    assert.equal(await script(`getComputedStyle(document.querySelector('textarea.composer-text').parentElement).backgroundColor`), 'rgb(52, 65, 92)', 'Dark composer did not inherit its themed surface');
    fs.writeFileSync(path.join(out, 'resizable-preview-compact.png'), (await win.webContents.capturePage(undefined, { stayHidden:true, stayAwake:true })).toPNG());
    await script(`document.querySelector('button[aria-label="账号与云端额度"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, pointerType:'mouse', ctrlKey:false }))`);
    await until(`!!document.querySelector('[role="menu"]') && document.body.textContent.includes('Test plan')`, 'Detailed account menu did not open');
    const menuBounds = await script(`(() => { const r = document.querySelector('[role="menu"]').getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right }; })()`);
    assert.ok(menuBounds.top >= 0 && menuBounds.bottom <= 640 && menuBounds.left >= 0 && menuBounds.right <= 960, 'Cloud allowance menu escaped compact viewport');
    fs.writeFileSync(path.join(out, 'account-menu-compact.png'), (await win.webContents.capturePage(undefined, { stayHidden:true, stayAwake:true })).toPNG());
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(await script(`document.querySelector('[data-account-details]')?.textContent.includes('月度包含金额')`), false, 'Removed billing detail reappeared');
    console.log('Layout smoke passed: previews, copy preference, keyboard/pointer resize, native chat, concise account menu and compact bounds.');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win?.destroy(); app.exit(1); }
});
