// Optional manual check: never opens a website, signs in, sends, or logs content.
// Close GrokDesk, then pass its data directory as the only argument. The installed
// extension connects to this read-only diagnostic using the existing local key.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) {
  console.log('Manual browser check: close GrokDesk, keep its installed browser extension enabled, then run node tests/web-live.cjs <absolute GrokDesk data directory>.');
  process.exit(0);
}
(async () => {
  const { createBrowserBridge } = await import(pathToFileURL(path.resolve(__dirname, '../electron/browser-bridge.mjs')).href);
  const controller = createBrowserBridge({ dataPath: directory });
  try {
    await controller.ready;
    const deadline = Date.now() + 30_000;
    while (controller.status().connection === 'disconnected' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    const state = controller.status();
    console.log(JSON.stringify({ connection: state.connection, connectedTabs: state.profiles.length, accountRecognized: !!state.account, messagesRecognized: state.messages.length, historyRecognized: state.history.length, capabilities: state.capabilities, error: state.error || null }));
    if (state.connection !== 'connected') process.exitCode = 1;
  } finally { controller.dispose(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
