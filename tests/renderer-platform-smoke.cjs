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
      win.webContents.on('console-message', details => { if (details?.level === 'error') errors.push(details.message); });
      await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
      await until(`!!document.querySelector('textarea.composer-text')`, `${platform}: composer did not mount`);
      assert.equal(await script(`document.documentElement.dataset.platform`), platform);
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
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
