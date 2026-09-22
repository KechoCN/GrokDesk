// Run with Electron and an app.asar extracted from the final portable artifact.
// No account, website or browser is opened; extension files are copied from ASAR.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const archive = process.argv[2];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let bridge;
  try {
    assert.ok(archive && path.isAbsolute(archive), 'Pass an absolute app.asar path');
    assert.equal(JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8')).version, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-packaged-bridge-'));
    const { createBrowserBridge } = await import(pathToFileURL(path.join(archive, 'electron', 'browser-bridge.mjs')).href);
    bridge = createBrowserBridge({ dataPath: directory, port:0, dependencies: { openPath: async () => {}, openExternal: async () => { throw new Error('No external browser should open'); } } });
    assert.equal(await bridge.ready, true);
    const state = await bridge.setup();
    for (const filename of ['manifest.json','content.js','background.js','config.js','popup.html','popup.js']) assert.ok(fs.statSync(path.join(state.setupPath, filename)).size > 0, filename);
    const content = fs.readFileSync(path.join(state.setupPath, 'content.js'), 'utf8');
    assert.ok(content.includes('data-sidebar'));
    assert.equal(state.connection, 'disconnected');
    assert.equal(fs.existsSync(path.join(archive,'electron','browser-extension','config.js')), false, 'Per-install connection key must not be distributed');
    console.log('Packaged browser smoke passed: final version, ASAR imports, complete extension extraction, actual-site selectors, and no packaged connection key.');
    bridge.dispose(); app.exit(0);
  } catch(error) { console.error(error); bridge?.dispose(); app.exit(1); }
});
