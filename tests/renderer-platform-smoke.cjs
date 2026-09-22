// Simulates bridge platform metadata to verify each renderer layout on the host.
// Actual native window decorations still require each OS's packaging smoke test.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-platform-ui-')));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const script = source => win.webContents.executeJavaScript(source);
async function until(source, message) {
  for (let i = 0; i < 100; i++) { if (await script(source)) return; await pause(50); }
  throw new Error(message);
}
app.whenReady().then(async () => {
  try {
    for (const platform of ['win32', 'darwin', 'linux']) {
      win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: [`--grokdesk-test-platform=${platform}`] } });
      const errors = [];
      const fontRequests = [];
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType === 'font') fontRequests.push(details.url);
        callback({});
      });
      win.webContents.on('console-message', details => { if (details?.level === 'error') errors.push(details.message); });
      await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
      await until(`!!document.querySelector('textarea.composer-text')`, `${platform}: composer did not mount`);
      assert.equal(await script(`document.documentElement.dataset.platform`), platform);
      const bodyFont = await script('getComputedStyle(document.body).fontFamily');
      assert.equal(bodyFont.includes('GrokDesk Noto Sans SC'), platform === 'linux', `${platform}: bundled CJK font must only enter the Linux fallback stack`);
      if (platform === 'linux') {
        const loaded = await script(`(() => {
          const fonts = window.grokdesk.firstComposerFonts();
          return fonts?.length > 0 && fonts.every(status => status === 'loaded');
        })()`);
        assert.equal(loaded, true, 'Linux composer mounted before the bundled CJK font loaded');
        const offlineFont = fontRequests.some(url => url.startsWith('file:') && url.includes('noto-sans-sc-full-wght') && url.endsWith('.woff2'));
        assert.equal(offlineFont, true, 'Linux CJK font was not loaded offline from the packaged file URL');
        await script(`document.querySelector('button[aria-label="原版 TUI"]').click()`);
        await until(`!!document.querySelector('.terminal-panel .xterm')`, 'Linux terminal did not mount');
        await script('document.fonts.ready.then(() => true)');
        const terminalFont = await script(`getComputedStyle(document.querySelector('.terminal-panel .xterm-rows')).fontFamily`);
        assert.ok(terminalFont.includes('GrokDesk Noto Sans SC'), 'Linux TUI did not include the bundled CJK fallback');
        assert.ok(terminalFont.indexOf('DejaVu Sans Mono') < terminalFont.indexOf('GrokDesk Noto Sans SC'), 'Linux TUI must prefer monospace Latin');
        assert.equal(await script(`!!document.querySelector('.notice-toast')`), false, 'Linux terminal font load or redraw failed');
      }
      assert.equal(await script(`document.querySelector('[data-desktop-window-frame]').dataset.platform`), platform);
      assert.equal(await script(`document.querySelectorAll('.window-control').length`), platform === 'win32' ? 3 : 0);
      const titlebarHeight = await script(`document.querySelector('.mac-titlebar')?.getBoundingClientRect().height || 0`);
      assert.equal(titlebarHeight, platform === 'darwin' ? 34 : 0);
      if (platform === 'darwin') assert.ok(await script(`document.querySelector('.sidebar').getBoundingClientRect().top >= 34`), 'macOS content overlaps native traffic lights');
      const primary = platform === 'darwin' ? 'metaKey' : 'ctrlKey';
      const wrong = platform === 'darwin' ? 'ctrlKey' : 'metaKey';
      await script(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ${wrong}: true, bubbles: true }))`);
      assert.equal(await script(`document.querySelectorAll('[role="dialog"]').length`), 0, `${platform}: wrong platform modifier opened settings`);
      await script(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ${primary}: true, bubbles: true }))`);
      await until(`!!document.querySelector('[role="dialog"]')`, `${platform}: settings shortcut failed`);
      await script(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(button => button.textContent === '通用').click()`);
      await until(`document.querySelector('[role="dialog"]').textContent.includes('发送快捷键')`, `${platform}: general settings missing`);
      await script(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(button => button.textContent === '引擎').click()`);
      await until(`!!document.querySelector('#engine-path')`, `${platform}: engine settings missing`);
      assert.equal(await script(`document.querySelector('#engine-path').placeholder`), platform === 'win32' ? 'grok.exe' : 'grok');
      await script(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(button => button.textContent === '关于').click()`);
      const platformName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
      await until(`document.querySelector('[role="dialog"]').textContent.includes('0.1.0 · ${platformName} · Electron')`, `${platform}: runtime version/platform missing from About`);
      assert.deepEqual(errors, [], `${platform}: renderer errors`);
      win.destroy();
      console.log(`${platform}: frame, native-control clearance, shortcuts, engine path and runtime About passed`);
    }
    // A missing/corrupt local font must warn and still mount the desktop.
    win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, partition: 'grokdesk-font-failure', additionalArguments: ['--grokdesk-test-platform=linux'] } });
    const warnings = [];
    win.webContents.on('console-message', details => { if (details?.level === 'warning') warnings.push(details.message); });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType === 'font' }));
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await until(`!!document.querySelector('textarea.composer-text')`, 'Linux font failure prevented the desktop from starting');
    assert.ok(warnings.some(message => message.includes('bundled Linux CJK font failed to load')), 'Linux font failure did not produce the startup warning');
    win.destroy();
    console.log('linux: failed local font load warns and still starts the desktop');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
