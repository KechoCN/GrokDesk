// Exercises production IPC/store with an unavailable engine and isolated data.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
// Optionally exercise the exact ASAR shipped in a release, including dependency resolution.
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-main-'));
const project = path.join(profile, 'My chosen project'); fs.mkdirSync(project);
const selectedFile = path.join(project, 'context.md'); fs.writeFileSync(selectedFile, 'User context');
fs.writeFileSync(path.join(profile, 'desktop-state.json'), JSON.stringify({
  version: 1, settings: { enginePath: path.join(profile, 'unavailable-grok.exe') }, workspaces: [], activeConversationId: null,
  conversations: [{ id: 'imported', title: 'Unloaded history', cwd: project, workspaceId: null, engineSessionId: 'native-history-not-loaded', pinned: false, archived: false, draft: '', messages: [], attachments: [], phase: 'ready', updatedAt: new Date().toISOString() }],
}));
process.argv.push('--data', profile);
let win, pickerOptions;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = async source => {
  const result = await win.webContents.executeJavaScript(`(async () => { try { return { ok: true, value: await (${source}) }; } catch(error) { return { ok: false, error: error.message }; } })()`);
  if (!result.ok) throw new Error(`${source}: ${result.error}`);
  return result.value;
};
dialog.showOpenDialog = async (_win, options) => { pickerOptions = options; return { canceled: false, filePaths: [project] }; };
app.on('browser-window-created', (_event, created) => { win = created; win.show = () => {}; });
(async () => {
  try {
    await import(pathToFileURL(path.join(root, 'electron', 'main.mjs')).href);
    for (let i = 0; i < 150; i++) { if (win && !win.webContents.isLoading() && await script(`!!window.grokdesk && !!document.querySelector('[data-desktop-window-frame]')`)) break; await pause(50); }
    let snapshot = await script(`window.grokdesk.bootstrap()`);
    assert.equal(await script('window.grokdesk.platform'), process.platform);
    assert.equal(await script('window.grokdesk.version'), app.getVersion());
    assert.equal(snapshot.engine.state, 'missing');
    assert.equal(snapshot.conversations.length, 1, 'Unknown imported history must survive startup');
    snapshot = await script(`window.grokdesk.addWorkspace()`);
    assert.equal(snapshot.workspaces[0].path, fs.realpathSync(project));
    assert.deepEqual(pickerOptions.properties, ['openDirectory', 'createDirectory']);
    const workspaceId = snapshot.workspaces[0].id;
    assert.equal(snapshot.selectedWorkspaceId, workspaceId, 'Folder picker did not report its selected project');
    snapshot = await script(`window.grokdesk.newConversation(${JSON.stringify(workspaceId)})`);
    const emptyId = snapshot.activeConversationId;
    assert.equal(snapshot.conversations.find(c => c.id === emptyId).cwd, fs.realpathSync(project));
    snapshot = await script(`window.grokdesk.newConversation(${JSON.stringify(workspaceId)})`);
    assert.equal(snapshot.conversations.some(c => c.id === emptyId), false, 'Abandoned empty task was not deleted');
    const draftId = snapshot.activeConversationId;
    await script(`window.grokdesk.updateConversation(${JSON.stringify(draftId)}, {draft:'Keep this draft'})`);
    snapshot = await script(`window.grokdesk.newConversation(${JSON.stringify(workspaceId)})`);
    assert.equal(snapshot.conversations.find(c => c.id === draftId).draft, 'Keep this draft');
    const attachmentId = snapshot.activeConversationId;
    await script(`window.grokdesk.attachFiles(${JSON.stringify(attachmentId)}, [${JSON.stringify(selectedFile)}])`);
    snapshot = await script(`window.grokdesk.newConversation(${JSON.stringify(workspaceId)})`);
    assert.equal(snapshot.conversations.find(c => c.id === attachmentId).attachments.length, 1);
    const clipboardBytes = [...Buffer.from('Clipboard document bytes')];
    snapshot = await script(`window.grokdesk.attachData(${JSON.stringify(attachmentId)}, [{name:'clipboard.txt',mime:'text/plain',data:new Uint8Array(${JSON.stringify(clipboardBytes)})}])`);
    const attached = snapshot.conversations.find(c => c.id === attachmentId).attachments;
    assert.equal(attached.length, 2);
    assert.equal(fs.readFileSync(attached[1].path, 'utf8'), 'Clipboard document bytes');
    const preview = await script(`window.grokdesk.readPreview(${JSON.stringify(attachmentId)}, ${JSON.stringify(attached[1].path)})`);
    assert.equal(preview.content, 'Clipboard document bytes');
    const listing = await script(`window.grokdesk.previewFiles(${JSON.stringify(attachmentId)})`);
    assert.ok(listing.files.some(file => file.path === selectedFile));
    await assert.rejects(script(`window.grokdesk.readPreview(${JSON.stringify(attachmentId)}, ${JSON.stringify(path.join(profile, 'desktop-state.json'))})`), /只能预览/);
    assert.equal(snapshot.settings.copyOnSelect, true);
    snapshot = await script(`window.grokdesk.updateSettings({copyOnSelect:false})`);
    assert.equal(snapshot.settings.copyOnSelect, false);
    const lastEmptyId = snapshot.activeConversationId;
    snapshot = await script(`window.grokdesk.closeConversation(${JSON.stringify(lastEmptyId)})`);
    assert.equal(snapshot.activeConversationId, null);
    assert.equal(snapshot.conversations.some(c => c.id === lastEmptyId), false);
    assert.equal(snapshot.conversations.some(c => c.id === 'imported'), true);
    for (const theme of ['lagoon', 'midnight', 'forest', 'rose']) {
      snapshot = await script(`window.grokdesk.updateSettings({theme:${JSON.stringify(theme)}})`);
      assert.equal(snapshot.settings.theme, theme);
    }
    assert.equal(await script(`(await window.grokdesk.account()).state`), 'unavailable');
    await script(`window.grokdesk.updateConversation(${JSON.stringify(attachmentId)}, {draft:'Carry context to scratch'})`);
    snapshot = await script(`window.grokdesk.setConversationWorkspace(${JSON.stringify(attachmentId)}, null)`);
    const moved = snapshot.conversations.find(c => c.id === snapshot.activeConversationId);
    assert.notEqual(moved.id, attachmentId);
    assert.equal(moved.workspaceId, null);
    assert.equal(moved.draft, 'Carry context to scratch');
    assert.equal(moved.attachments.length, 2);
    assert.equal((await script(`window.grokdesk.readPreview(${JSON.stringify(moved.id)}, ${JSON.stringify(moved.attachments[1].path)})`)).content, 'Clipboard document bytes');
    assert.equal(fs.readFileSync(selectedFile, 'utf8'), 'User context');
    assert.equal(fs.existsSync(path.join(profile, 'Documents', 'Workspaces')), false, 'App created an unwanted project directory');
    console.log('Main IPC smoke passed: chosen project folder, empty-task cleanup, draft/attachment/history preservation, themes, unavailable account state.');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
})();
