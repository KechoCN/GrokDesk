import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserBridge } from '../electron/browser-bridge.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-browser-isolation-'));
  const bridge = createBrowserBridge({ dataPath: directory, port: 0, dependencies: { openExternal: async () => {}, openPath: async () => {} } });
  t.after(() => { bridge.dispose(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('grokdesk-browser-isolation-')); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await bridge.ready, true);
  const source = fs.readFileSync(path.join(directory, 'browser-extension', 'config.js'), 'utf8');
  const config = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
  const post = async (route, body) => {
    const response = await fetch(config.endpoint + route, { method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200); return response.json();
  };
  const snapshot = (clientId, nickname) => post('/snapshot', { clientId, tabId: 1, state: { url: 'https://grok.com/c/' + clientId, title: nickname, account: { nickname }, messages: [], capabilities: { send: true } } });
  return { bridge, post, snapshot };
}

test('an expired selected browser never silently switches to another account', async t => {
  const { bridge, snapshot } = await fixture(t);
  const now = Date.now;
  let clock = now(); Date.now = () => clock;
  t.after(() => { Date.now = now; });
  await snapshot('alice', 'Alice');
  assert.equal(bridge.status().activeProfileId, 'alice:1');
  clock += 40_000;
  await snapshot('bob', 'Bob');
  assert.equal(bridge.status().activeProfileId, 'alice:1');
  assert.equal(bridge.status().connection, 'disconnected');
  assert.equal(bridge.status().capabilities.send, false);
  await assert.rejects(bridge.send('Do not send to Bob'), /连接|就绪|登录/);
  await snapshot('alice', 'Alice');
  assert.equal(bridge.status().connection, 'connected');
  assert.equal(bridge.status().account.nickname, 'Alice');
});

test('failed browser focus preserves the selected account', async t => {
  const { bridge, post, snapshot } = await fixture(t);
  await snapshot('alice', 'Alice'); await snapshot('bob', 'Bob');
  const switching = bridge.action('switch-account', 'bob:1');
  const result = assert.rejects(switching, /Focus failed/);
  const poll = await post('/poll', { clientId: 'bob' });
  assert.equal(poll.commands.length, 1);
  assert.equal(poll.commands[0].expectedUrl, 'https://grok.com/c/bob');
  await post('/result', { clientId: 'bob', id: poll.commands[0].id, ok: false, error: 'Focus failed' });
  await result;
  assert.equal(bridge.status().activeProfileId, 'alice:1');
});

test('send binds the visible target and blocks concurrent navigation or duplicate send', async t => {
  const { bridge, post, snapshot } = await fixture(t);
  await snapshot('alice', 'Alice');
  await assert.rejects(bridge.send('Wrong conversation', [], { profileId: 'alice:1', url: 'https://grok.com/c/stale' }), /会话已改变/);
  const sending = bridge.send('One message', [], { profileId: 'alice:1', url: 'https://grok.com/c/alice' });
  const poll = await post('/poll', { clientId: 'alice' });
  assert.equal(poll.commands.length, 1);
  assert.equal(poll.commands[0].expectedUrl, 'https://grok.com/c/alice');
  assert.equal(poll.commands[0].expectedAccount, 'Alice');
  await assert.rejects(bridge.send('Duplicate'), /等待官网确认/);
  await assert.rejects(bridge.action('new-chat'), /等待官网确认/);
  await post('/result', { clientId: 'alice', id: poll.commands[0].id, ok: true });
  await sending;
});
