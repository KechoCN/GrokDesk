import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createBrowserBridge, normalizeBrowserSnapshot } from '../electron/browser-bridge.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-bridge-test-'));
  const opened = [], events = [];
  const controller = createBrowserBridge({ dataPath: directory, port: 0, emit: event => events.push(event), dependencies: { openPath: async value => opened.push(value), openExternal: async value => opened.push(value) } });
  t.after(() => { controller.dispose(); fs.rmSync(directory, { force: true, recursive: true }); });
  await controller.ready;
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'browser-extension', 'config.js'), 'utf8').replace('globalThis.GROKDESK_CONFIG = ', '').trim().replace(/;$/, ''));
  const post = (route, body = {}, headers = {}) => fetch(config.endpoint + route, { method: 'POST', headers: { Origin: 'chrome-extension://' + 'a'.repeat(32), Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ clientId: 'browser-a', ...body }) });
  const snapshot = (tabId = 1, url = 'https://grok.com/c/first') => post('/snapshot', { tabId, state: { url, title: 'Grok', account: { nickname: 'Browser User', avatarUrl: 'https://grok.com/avatar.png', token: 'never-expose' }, messages: [{ id: 'one', role: 'user', content: 'Hello' }], capabilities: { send: true, stop: true, attachments: true } } });
  return { controller, config, post, snapshot, opened, events };
}

test('browser bridge rejects foreign origins, bad tokens, host rebinding, and non-Grok snapshots', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/snapshot', {}, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.post('/snapshot', {}, { Authorization: 'Bearer wrong' })).status, 401);
  const rebound = await new Promise(resolve => { const request = http.request(f.config.endpoint + '/snapshot', { method: 'POST', headers: { Host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); }); request.end('{}'); });
  assert.equal(rebound, 403);
  assert.equal((await f.post('/snapshot', {}, { Authorization: 'Bearer ' + 'é'.repeat(64) })).status, 401);
  assert.equal((await f.post('/snapshot', { tabId: 1, state: { url: 'https://grok.com.attacker.test' } })).status, 400);
  assert.equal((await f.snapshot()).status, 200);
  assert.equal(f.controller.status().connection, 'connected');
  assert.equal(JSON.stringify(f.controller.status()).includes('never-expose'), false);
  assert.equal(f.controller.status().account.nickname, 'Browser User');
  assert.equal(f.controller.status().account.avatarUrl, 'https://grok.com/avatar.png');
});

test('browser bridge routes one authenticated send to the chosen URL and preserves failed operations', async t => {
  const f = await fixture(t); await f.snapshot();
  const operation = f.controller.send('Hi', [{ name: 'notes.txt', mime: 'text/plain', data: new Uint8Array([65]) }], { profileId: 'browser-a:1', url: 'https://grok.com/c/first' });
  const response = await (await f.post('/poll')).json();
  assert.equal(response.commands.length, 1);
  const command = response.commands[0];
  assert.equal(command.action, 'send'); assert.equal(command.tabId, 1); assert.equal(command.expectedUrl, 'https://grok.com/c/first'); assert.equal(command.expectedAccount, 'Browser User'); assert.equal(command.attachments[0].base64, 'QQ==');
  await assert.rejects(f.controller.send('duplicate'), /等待官网确认/);
  await f.post('/result', { id: command.id, ok: true }); await operation;
  const rejected = assert.rejects(f.controller.send('Again'), /Website draft/);
  const failure = await (await f.post('/poll')).json();
  await f.post('/result', { id: failure.commands[0].id, ok: false, error: 'Website draft exists' });
  await rejected;
});

test('closed or changed selected tabs never silently redirect messages to another account', async t => {
  const f = await fixture(t); await f.snapshot(1); await f.snapshot(2, 'https://grok.com/c/second');
  assert.equal(f.controller.status().activeProfileId, 'browser-a:1');
  await assert.rejects(f.controller.send('stale account', [], { profileId: 'browser-a:1', url: 'https://grok.com/c/first', accountNickname: 'Previously visible account' }), /改变/);
  await assert.rejects(f.controller.send('stale', [], { profileId: 'browser-a:2', url: 'https://grok.com/c/second' }), /改变/);
  await f.post('/closed', { tabId: 1 }); await f.snapshot(2, 'https://grok.com/c/second');
  assert.equal(f.controller.status().activeProfileId, 'browser-a:1'); assert.equal(f.controller.status().connection, 'disconnected');
  await assert.rejects(f.controller.send('do not redirect'), /未就绪/);
  const selected = assert.rejects(f.controller.action('switch-account', 'browser-a:2'), /Tab vanished/);
  const command = (await (await f.post('/poll')).json()).commands[0];
  await f.post('/result', { id: command.id, ok: false, error: 'Tab vanished' });
  await selected; assert.equal(f.controller.status().activeProfileId, 'browser-a:1');
});

test('extension setup is packaged, user-readable and reveals no secret in state', async t => {
  const f = await fixture(t); const state = await f.controller.setup();
  assert.ok(state.setupRequestedAt); assert.equal(f.opened[0], state.setupPath);
  assert.ok(fs.existsSync(path.join(state.setupPath, 'manifest.json')));
  assert.equal(JSON.stringify(state).includes(f.config.token), false);
  await f.controller.action('external'); assert.equal(f.opened.at(-1), 'https://grok.com/');
  await assert.rejects(f.controller.action('open-chat', 'file:///C:/secret'), /官网/);
});

test('snapshot normalizer excludes executable avatars and off-site history', () => {
  const value = normalizeBrowserSnapshot({ url: 'https://grok.com/', account: { nickname: 'A', avatarUrl: 'javascript:alert(1)' }, messages: [{ role: 'tool', content: 'no' }], history: [{ title: 'bad', url: 'https://attacker.test' }] });
  assert.equal(value.account.avatarUrl, undefined); assert.deepEqual(value.history, []); assert.deepEqual(value.messages, []);
});
