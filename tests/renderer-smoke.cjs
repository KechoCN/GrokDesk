// Run with Electron against the compiled renderer. Uses a separate profile and fixture API;
// never opens a real Grok session or changes the user's app data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-renderer-'));
app.setPath('userData', profile);
// Xvfb has no hardware compositor. A hidden Linux window can have no Viz surface,
// so map this fixture onto the CI virtual display and render it in software.
// Keep local desktop runs hidden and leave the production GPU policy unchanged.
const linuxCI = process.platform === 'linux' && process.env.CI === 'true';
if (linuxCI) app.disableHardwareAcceleration();
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = source => win.webContents.executeJavaScript(source);
async function capture(label) {
  const options = { stayHidden: !linuxCI, stayAwake: true };
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      // Refresh the compositor after theme changes/resizes before reading pixels.
      await win.webContents.capturePage(undefined, options);
      await pause(100);
      const image = await win.webContents.capturePage(undefined, options);
      assert.ok(!image.isEmpty() && image.getSize().width > 0 && image.getSize().height > 0, `${label}: empty screenshot`);
      return image;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await pause(150 * attempt);
    }
  }
  throw new Error(`${label}: page capture failed after 4 attempts (${lastError?.message || lastError})`, { cause: lastError });
}
async function until(source, message) {
  for (let i = 0; i < 80; i++) { if (await script(source)) return; await pause(50); }
  throw new Error(message);
}
async function input(value) {
  await script(`(() => { const element = document.querySelector('textarea.composer-text'); element.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.setSelectionRange(element.value.length, element.value.length); element.dispatchEvent(new Event('select', { bubbles: true })); })()`);
  await pause(300);
}
async function key(keyCode) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(100); }
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: linuxCI, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (...args) => {
      const details = args[1];
      if (typeof details === 'object' && details.level === 'error') errors.push(details.message);
    });
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await win.webContents.insertCSS('*, *::before, *::after { transition: none !important; animation: none !important; }');
    await until(`!!document.querySelector('textarea.composer-text')`, 'Composer did not mount');
    assert.equal(await script(`document.body.textContent.includes('添加现有文件夹') || document.body.textContent.includes('新建工作区')`), false);
    await input('/');
    await until(`document.body.textContent.includes('example-skill') && document.body.textContent.includes('example-plugin')`, 'Slash completion missing installed skills or plugins');
    await key('Escape');
    assert.equal(await script(`document.querySelectorAll('[role="listbox"]').length`), 0);
    await input('@');
    await until(`document.body.textContent.includes('README.md')`, 'File context completion missing');
    await key('Enter');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'attachFiles' && call.paths[0].endsWith('README.md'))`, 'Selecting file did not attach context');
    assert.equal(await script(`window.grokdeskTest.calls().some(call => call.name === 'send')`), false);
    await input('/example-skill');
    await until(`document.body.textContent.includes('An installed test skill')`, 'Skill filtered completion missing');
    await key('Tab');
    await until(`window.grokdeskTest.calls().some(call => call.name === 'attachFiles' && call.paths[0].endsWith('SKILL.md'))`, 'Selecting skill did not load its instruction file');
    await input('');
    await script(`(() => { const zone = document.querySelector('[data-conversation-drop-zone]'); if (!zone) throw new Error('Conversation drop zone missing'); const data = new DataTransfer(); data.items.add(new File(['dragged context'], 'dragged.txt', { type: 'text/plain' })); zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data })); zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); })()`);
    await until(`window.grokdeskTest.calls().filter(call => call.name === 'attachFiles' && call.paths[0].endsWith('dragged.txt')).length === 1`, 'Dropping onto conversation did not attach exactly once');
    assert.equal(await script(`document.body.textContent.includes('松开以添加文件')`), false);
    await input('before after');
    await script(`(() => { const input = document.querySelector('textarea.composer-text'); input.setSelectionRange(7, 7); const data = new DataTransfer(); data.setData('text/plain', 'pasted '); input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
    await until(`document.querySelector('textarea.composer-text').value === 'before pasted after'`, 'Plain text paste did not preserve its insertion point');
    await script(`(() => { const input = document.querySelector('textarea.composer-text'); const data = new DataTransfer(); data.items.add(new File(['image bytes'], 'clipboard-image.png', { type: 'image/png' })); input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'attachData' && call.files[0].name === 'clipboard-image.png' && call.files[0].size === 11)`, 'Screenshot paste did not transfer image bytes');
    await script(`(() => { const input = document.querySelector('textarea.composer-text'); const data = new DataTransfer(); data.items.add(new File(['%PDF bytes'], 'clipboard-document.pdf', { type: 'application/pdf' })); input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
    await until(`window.grokdeskTest.calls().some(call => call.name === 'attachFiles' && call.paths[0].endsWith('clipboard-document.pdf'))`, 'Copied local file was not attached');
    await script(`window.grokdeskTest.nativeClipboard(true)`);
    await script(`(() => { const input = document.querySelector('textarea.composer-text'); const data = new DataTransfer(); data.setData('application/x-moz-file', 'native file marker'); data.setData('text/plain', 'native file list must not enter draft'); input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
    await pause(150);
    assert.equal(await script(`document.querySelector('textarea.composer-text').value`), 'before pasted after');
    await script(`window.grokdeskTest.nativeClipboard(false)`);
    const dragRegion = await script(`(() => { const header = document.querySelector('header.window-drag'); const rect = header.getBoundingClientRect(); let count = 0; for (let x = rect.left + 10; x < rect.right - 10; x += 5) { let element = document.elementFromPoint(x, rect.top + rect.height / 2); let drag = ''; while (element) { const region = getComputedStyle(element).getPropertyValue('-webkit-app-region'); if (region === 'drag' || region === 'no-drag') { drag = region; break; } element = element.parentElement; } if (drag === 'drag') count++; } return count; })()`);
    assert.ok(dragRegion > 5, 'Top header has no usable window drag area');
    await script(`document.querySelector('button[title="设置"]').click()`);
    await until(`!!document.querySelector('[role="dialog"]')`, 'Settings dialog did not open');
    const out = path.join(root, 'artifacts', 'verification'); fs.mkdirSync(out, { recursive: true });
    await pause(200);
    fs.writeFileSync(path.join(out, 'settings-themes.png'), (await capture('settings-themes')).toPNG());
    for (const theme of ['lagoon', 'midnight', 'forest', 'rose']) {
      const labels = { lagoon: '晴湾', midnight: '星夜', forest: '苔林', rose: '蔷薇' };
      await script(`Array.from(document.querySelectorAll('button.theme-card')).find(button => button.textContent.includes(${JSON.stringify(labels[theme])})).click()`);
      await pause(150);
      assert.equal(await script(`document.documentElement.classList.contains('theme-${theme}')`), true, `Theme ${theme} was not applied`);
      fs.writeFileSync(path.join(out, `${theme}.png`), (await capture(theme)).toPNG());
    }
    await script(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(button => button.textContent.includes('订阅与用量')).click()`);
    await until(`document.body.textContent.includes('Test plan') && document.body.textContent.includes('72.0%')`, 'Cloud subscription UI did not display returned plan and quota');
    await pause(150);
    fs.writeFileSync(path.join(out, 'account.png'), (await capture('account')).toPNG());
    await script(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(button => button.textContent.includes('Grok 完整设置')).click()`);
    await until(`document.querySelector('.settings-config-editor')?.value.includes('fixture')`, 'Full config editor did not show loaded TOML');
    await pause(150);
    fs.writeFileSync(path.join(out, 'engine-settings.png'), (await capture('engine-settings')).toPNG());
    await key('Escape');
    await input('/');
    await until(`!!document.querySelector('[role="listbox"]')`, 'Completion list missing after theme switch');
    const menuVisible = await script(`(() => { const menu = document.querySelector('[role="listbox"]'); const r = menu.getBoundingClientRect(); return r.height > 10 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`);
    assert.ok(menuVisible, 'Completion menu is outside the viewport');
    fs.writeFileSync(path.join(out, 'composer-completion.png'), (await capture('composer-completion')).toPNG());
    win.setContentSize(960, 640);
    await pause(300);
    const compactVisible = await script(`(() => { const r = document.querySelector('[role="listbox"]').getBoundingClientRect(); return r.height > 10 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`);
    assert.ok(compactVisible, 'Completion menu is clipped at 960 × 640');
    fs.writeFileSync(path.join(out, 'compact-completion.png'), (await capture('compact-completion')).toPNG());
    assert.deepEqual(errors, [], 'Renderer errors');
    console.log('Renderer smoke passed: completions, keyboard selection, attachments, project entry, title drag regions, theme application.');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); }
});
