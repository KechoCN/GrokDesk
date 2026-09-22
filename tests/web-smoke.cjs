// Offline Electron regression: Chat must not create an embedded remote browser.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-web-'));
app.setPath('userData', profile);
(async () => {
  try {
    await app.whenReady();
    const { createGrokWeb, remoteWebPreferences } = await import(pathToFileURL(path.resolve(__dirname, '../electron/grok-web.mjs')).href);
    const window = new BrowserWindow({ width: 1100, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await window.loadURL('data:text/html,<html><body>GrokDesk test</body></html>');
    const opened = [];
    const controller = createGrokWeb({ window, dataPath: profile, port: 0, dependencies: { openExternal: async url => opened.push(url), openPath: async value => opened.push(value) } });
    await controller.ready;
    controller.mount({ x: 200, y: 60, width: 800, height: 690, visible: true });
    assert.equal(window.contentView.children.length, 0, 'Chat must never create a WebContentsView');
    assert.equal(controller.status().connection, 'disconnected');
    await controller.action('home');
    assert.equal(opened.at(-1), 'https://grok.com/');
    await controller.setup();
    assert.ok(fs.existsSync(path.join(opened.at(-1), 'manifest.json')));
    assert.equal(window.contentView.children.length, 0);
    const preferences = remoteWebPreferences('isolated-build-auth');
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    controller.dispose(); window.destroy();
    console.log('Browser smoke passed: no embedded Chat surface, native browser routing, packaged extension setup, preserved isolated Build auth.');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
})();
