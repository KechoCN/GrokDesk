import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeskStore, inside, isDisposableConversation } from '../electron/store.mjs';

function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-store-test-'));
  t.after(() => {
    assert.ok(inside(os.tmpdir(), root) && path.basename(root).startsWith('grokdesk-store-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const create = () => new DeskStore(path.join(root, 'data'), path.join(root, 'documents'));
  return { root, create, store: create() };
}

test('project switch carries unsent draft and snapshot bytes while keeping original session and history', t => {
  const { store, create, root } = temporaryStore(t);
  const project = store.addWorkspace(root);
  const source = store.newConversation();
  source.engineSessionId = 'existing-engine-session'; source.transient = false;
  source.messages.push({ id:'history', role:'user', content:'Existing request' });
  source.draft = 'Unsent next step';
  const dir = path.join(store.dataDir, 'attachments', source.id);
  fs.mkdirSync(dir, { recursive:true });
  const original = path.join(dir, 'fixture.txt'); fs.writeFileSync(original, 'snapshot bytes');
  source.attachments = [{ id:'file', name:'fixture.txt', path:original, sourcePath:path.join(root,'original.txt'), mime:'text/plain', kind:'text', size:14 }];
  const target = store.setConversationWorkspace(source.id, project.id);
  assert.notEqual(target.id, source.id);
  assert.equal(target.cwd, fs.realpathSync.native(root));
  assert.equal(target.workspaceId, project.id);
  assert.equal(target.draft, 'Unsent next step');
  assert.equal(target.engineSessionId, undefined);
  assert.equal(fs.readFileSync(target.attachments[0].path, 'utf8'), 'snapshot bytes');
  assert.ok(inside(path.join(store.dataDir, 'attachments', target.id), target.attachments[0].path));
  assert.equal(source.messages.length, 1);
  assert.equal(source.engineSessionId, 'existing-engine-session');
  assert.equal(source.draft, ''); assert.equal(source.attachments.length, 0);
  assert.equal(fs.readFileSync(original,'utf8'), 'snapshot bytes');
  const reopened = create();
  assert.equal(reopened.state.activeConversationId, target.id);
  assert.equal(reopened.conversation(target.id).draft, 'Unsent next step');
  const loose = store.setConversationWorkspace(target.id, null);
  assert.equal(loose.workspaceId, null); assert.equal(loose.draft, target.draft || 'Unsent next step');
  assert.ok(inside(store.documentsDir, loose.cwd));
});

test('project switching rejects busy tasks and rolls back a failed attachment transfer', t => {
  const { store, root } = temporaryStore(t);
  const project = store.addWorkspace(root), source = store.newConversation();
  source.draft = 'Keep me'; source.phase = 'running';
  assert.throws(() => store.setConversationWorkspace(source.id, project.id), /停止/);
  source.phase = 'ready';
  source.attachments = [{ id:'missing', path:path.join(root,'missing.txt') }];
  assert.throws(() => store.setConversationWorkspace(source.id, project.id));
  assert.equal(store.state.activeConversationId, source.id);
  assert.equal(source.draft, 'Keep me'); assert.equal(source.attachments.length, 1);
  assert.equal(store.state.conversations.length, 1);
  assert.throws(() => store.setConversationWorkspace(source.id, 'unknown'), /工作区不存在/);
});

test('new untouched tasks disappear on restart without creating replacements', t => {
  const { store, create } = temporaryStore(t);
  const c = store.newConversation();
  assert.equal(isDisposableConversation(c), true);
  const reopened = create();
  assert.equal(reopened.state.conversations.length, 0);
  assert.equal(reopened.state.activeConversationId, null);
});

test('native empty tasks retain their session ID for cleanup and cannot be reimported', t => {
  const { store, create } = temporaryStore(t);
  const c = store.newConversation();
  c.engineSessionId = 'native-empty'; store.save();
  const reopened = create();
  assert.equal(reopened.state.conversations[0].pendingEmptyCleanup, true);
  reopened.importSessions([{ sessionId: c.engineSessionId, cwd: c.cwd }]);
  assert.equal(reopened.state.conversations.length, 1);
  assert.equal(reopened.state.activeConversationId, null);
});

test('unloaded native history and preexisting tasks are never treated as empty drafts', t => {
  const { store, create, root } = temporaryStore(t);
  store.importSessions([{ sessionId: 'historical', cwd: root }]);
  const legacy = store.newConversation(); delete legacy.transient; store.save();
  const reopened = create();
  assert.equal(reopened.state.conversations.length, 2);
  assert.ok(reopened.state.conversations.every(c => !isDisposableConversation(c) && !c.pendingEmptyCleanup));
});

test('drafts, attachments, messages, running work and intentional metadata survive restart', t => {
  const { store, create } = temporaryStore(t);
  const mutations = [
    c => { c.draft = 'unfinished draft'; },
    c => { c.attachments.push({ id: 'attachment' }); },
    c => { c.messages.push({ id: 'message', role: 'user', content: 'task' }); },
    c => { c.phase = 'running'; },
    c => { c.pinned = true; },
    c => { c.manualTitle = true; c.title = 'planned task'; },
  ];
  for (const mutate of mutations) { const c = store.newConversation(); mutate(c); assert.equal(isDisposableConversation(c), false); }
  store.save();
  const reopened = create();
  assert.equal(reopened.state.conversations.length, mutations.length);
  assert.ok(reopened.state.conversations.every(c => !c.pendingEmptyCleanup));
});

test('a late saved draft revives a pending cleanup task', t => {
  const { store } = temporaryStore(t);
  const c = store.newConversation(); c.pendingEmptyCleanup = true;
  store.updateConversation(c.id, { draft: 'keep this draft' });
  assert.equal(c.pendingEmptyCleanup, undefined);
  assert.equal(isDisposableConversation(c), false);
});

test('draft changes can update memory immediately and persist together on shutdown', t => {
  const { store, create } = temporaryStore(t);
  const c = store.newConversation();
  store.updateConversation(c.id, { draft: 'latest text' }, { persist: false });
  assert.equal(store.conversation(c.id).draft, 'latest text');
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).conversations[0].draft, '');
  store.save();
  assert.equal(create().conversation(c.id).draft, 'latest text');
});

test('projects use the selected folder and adding an archived project restores it', t => {
  const { store, root } = temporaryStore(t);
  const selected = path.join(root, 'chosen-project'); fs.mkdirSync(selected);
  const project = store.addWorkspace(selected);
  assert.equal(project.path, fs.realpathSync.native(selected));
  project.archived = true;
  const restored = store.addWorkspace(selected);
  assert.equal(restored.id, project.id);
  assert.equal(restored.archived, false);
  assert.equal(store.state.workspaces.length, 1);
  assert.equal(store.newConversation(project.id).cwd, project.path);
});

test('all theme palettes are accepted and persisted', t => {
  const { store, create } = temporaryStore(t);
  for (const theme of ['system', 'light', 'dark', 'lagoon', 'midnight', 'forest', 'rose']) {
    store.updateSettings({ theme });
    assert.equal(create().state.settings.theme, theme);
  }
  assert.throws(() => store.updateSettings({ theme: 'unknown' }));
});
