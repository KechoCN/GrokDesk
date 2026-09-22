// User-level composer interactions against fixture data; no real engine or account.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-composer-context-')));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const script = code => win.webContents.executeJavaScript(code);
async function until(code, message) { for (let i = 0; i < 80; i++) { if (await script(code)) return; await pause(50); } throw new Error(message); }
async function click(selector) { await script(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100); }
async function clickText(selector, text) { await script(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(button => button.textContent.includes(${JSON.stringify(text)})).click()`); await pause(100); }
async function input(selector, value) { await script(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`); await pause(150); }
async function key(keyCode) { win.webContents.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(100); }
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await until(`!!document.querySelector('.composer-context-bar')`, 'Composer context bar did not mount');
    await input('textarea.composer-text', 'Keep this draft');
    await script(`window.grokdesk.attachFiles('conversation', ['D:\\Example\\README.md'])`);
    await click('button[aria-label="选择项目"]');
    await until(`document.activeElement?.getAttribute('aria-label') === '搜索项目'`, 'Project search did not get keyboard focus');
    await input('input[aria-label="搜索项目"]', 'missing');
    assert.equal(await script(`document.querySelector('.composer-project-popover').textContent.includes('没有找到匹配的项目')`), true);
    await clickText('.composer-project-popover button', '不使用项目');
    await until(`window.grokdeskTest.state().conversations[0].workspaceId === null`, 'No-project selection did not update workspace');
    assert.equal(await script(`window.grokdeskTest.state().conversations[0].draft`), 'Keep this draft');
    assert.equal(await script(`window.grokdeskTest.state().conversations[0].attachments.length`), 1);
    await click('button[aria-label="选择项目"]');
    await until(`document.activeElement?.getAttribute('aria-label') === '搜索项目'`, 'Project search did not regain focus');
    await key('Down');
    assert.equal(await script(`document.activeElement.textContent`), 'GrokDesk', 'ArrowDown did not focus the first project');
    await key('Enter');
    await until(`window.grokdeskTest.state().conversations[0].workspaceId === 'project'`, 'Keyboard project selection did not restore project');

    await click('button[aria-label="技能与插件"]');
    await until(`document.querySelector('.composer-extensions-popover')?.textContent.includes('example-skill')`, 'Extension picker did not show installed skills');
    await input('input[aria-label="搜索技能与插件"]', 'plugin');
    await until(`!document.querySelector('.composer-extensions-popover').textContent.includes('example-skill') && document.querySelector('.composer-extensions-popover').textContent.includes('example-plugin')`, 'Extension search did not filter results');
    await clickText('.composer-extensions-popover button', 'example-plugin');
    await until(`document.querySelector('textarea.composer-text').value.includes('Use the example-plugin plugin.')`, 'Plugin selection did not enter prompt');
    assert.equal(await script(`document.querySelector('textarea.composer-text').value.startsWith('Keep this draft')`), true);
    await click('button[aria-label="技能与插件"]');
    await until(`document.querySelector('.composer-extensions-popover')?.textContent.includes('example-skill')`, 'Skill did not reload');
    await clickText('.composer-extensions-popover button', 'example-skill');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'attachFiles' && call.paths[0].endsWith('SKILL.md'))`, 'Skill selection did not attach instructions');
    await until(`document.querySelector('textarea.composer-text').value.includes('/example-skill ')`, 'Skill request missing from prompt');
    await click('button[aria-label="技能与插件"]');
    await until(`document.querySelectorAll('.composer-extensions-popover button[aria-pressed="true"]').length === 2`, 'Selected extensions were not marked');
    assert.equal(await script(`Array.from(document.querySelectorAll('.composer-extensions-popover button[aria-pressed="true"]')).every(button => button.disabled)`), true);
    await input('input[aria-label="搜索技能与插件"]', 'no-such-extension');
    await until(`document.querySelector('.composer-extensions-popover').textContent.includes('没有找到匹配的技能或插件')`, 'Extension empty state missing');
    await key('Escape');
    await script(`window.grokdeskTest.contextFailure(true)`);
    await click('button[aria-label="技能与插件"]');
    await until(`document.querySelector('.composer-extensions-popover [role="alert"]')?.textContent.includes('扩展目录暂时不可用')`, 'Extension failure was not displayed');
    await script(`window.grokdeskTest.contextFailure(false)`);
    await clickText('.composer-extensions-popover button', '重试');
    await until(`document.querySelector('.composer-extensions-popover')?.textContent.includes('example-plugin')`, 'Extension retry did not recover');
    await key('Escape');

    await script(`window.grokdeskTest.setPhase('running')`);
    await pause(100);
    assert.equal(await script(`document.querySelector('button[aria-label="选择项目"]').disabled && document.querySelector('button[aria-label="技能与插件"]').disabled`), true, 'Running task still allowed context mutation');
    await script(`window.grokdeskTest.setPhase('ready')`);
    await pause(100);
    await click('button[aria-label="打开本机终端"]');
    await until(`!!document.querySelector('.terminal-panel') && document.querySelector('.composer-context-terminal').getAttribute('aria-pressed') === 'true'`, 'Composer terminal control did not show terminal');
    await click('button[aria-label="收起本机终端"]');
    await until(`!document.querySelector('.terminal-panel') && document.querySelector('.composer-context-terminal').getAttribute('aria-pressed') === 'false'`, 'Composer terminal control did not hide terminal');
    win.setContentSize(960, 640);
    await pause(150);
    await click('button[aria-label="选择项目"]');
    assert.equal(await script(`(() => { const r = document.querySelector('.composer-project-popover').getBoundingClientRect(); return r.width > 200 && r.height > 100 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`), true, 'Project picker escaped compact viewport');
    const out = path.join(root, 'artifacts', 'verification'); fs.mkdirSync(out, { recursive: true });
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await pause(100);
    fs.writeFileSync(path.join(out, 'composer-project-bar.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    console.log('Composer project, extension, draft preservation, busy-state and terminal checks passed.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
