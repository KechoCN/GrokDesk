import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { GrokAdapter } from '../electron/grok-adapter.mjs';

function fixture({ updates = [], response = {}, failure, activity = 'idle' } = {}) {
  const requests = [], events = [];
  const client = new EventEmitter();
  client.request = async (method, params) => {
    requests.push({ method, params });
    if (method === '_x.ai/sessions/list') return { sessions: [{ sessionId: 'native', activity }] };
    if (method === 'session/load') {
      if (failure) throw failure;
      for (const update of updates) client.emit('notification', 'session/update', { sessionId: 'native', update });
      return response;
    }
    throw new Error('Unexpected request: ' + method);
  };
  const adapter = new GrokAdapter({ emit: value => events.push(value), dependencies: { client, skipTerminal: true } });
  adapter.status = { state: 'ready', auth: 'inherited' };
  adapter.capabilities = { loadSession: true };
  const session = { id: 'local', engineSessionId: 'native', cwd: os.tmpdir(), phase: 'ready', owner: null, replay: false };
  adapter.sessions.set(session.id, session); adapter.engineSessions.set(session.engineSessionId, session);
  return { adapter, session, requests, events, client };
}

test('automatic cleanup explicitly reloads even a cached session and only reads history', async () => {
  const { adapter, requests, session } = fixture();
  assert.equal(await adapter.verifyEmptyHistory('local'), true);
  assert.deepEqual(requests.map(request => request.method), ['_x.ai/sessions/list', 'session/load']);
  assert.equal(requests[1].params.sessionId, 'native');
  assert.equal(session.claiming, false);
  assert.equal(session.replay, false);
});

test('replayed external messages prevent empty confirmation and reach the renderer as replay', async () => {
  const update = { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Work submitted elsewhere' } };
  const { adapter, events } = fixture({ updates: [update] });
  assert.equal(await adapter.verifyEmptyHistory('local'), false);
  const replay = events.find(event => event.type === 'update');
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.update, update);
});

test('metadata replay permits cleanup, but unknown replay is conservatively retained', async () => {
  const metadata = fixture({ updates: [{ sessionUpdate: 'available_commands_update', availableCommands: [] }] });
  assert.equal(await metadata.adapter.verifyEmptyHistory('local'), true);
  const unknown = fixture({ updates: [{ sessionUpdate: 'future_transcript_event' }] });
  assert.equal(await unknown.adapter.verifyEmptyHistory('local'), false);
});

test('Grok 1.0.40 empty background task roster permits cleanup without assuming unknown rosters are empty', async () => {
  const empty = fixture({ updates: [{ sessionUpdate: 'background_tasks', tasks: [] }] });
  assert.equal(await empty.adapter.verifyEmptyHistory('local'), true);
  for (const update of [
    { sessionUpdate: 'background_tasks', tasks: [{ status: 'running' }] },
    { sessionUpdate: 'background_tasks', tasks: null },
    { sessionUpdate: 'background_tasks' },
    { sessionUpdate: 'background_tasks', tasks: [], active: true },
  ]) {
    const unknown = fixture({ updates: [update] });
    assert.equal(await unknown.adapter.verifyEmptyHistory('local'), false);
  }
});

test('unsupported, failed or malformed history verification never confirms empty', async () => {
  const unsupported = fixture(); unsupported.adapter.capabilities.loadSession = false;
  await assert.rejects(unsupported.adapter.verifyEmptyHistory('local'));
  assert.equal(unsupported.requests.length, 0);
  const failed = fixture({ failure: new Error('offline') });
  await assert.rejects(failed.adapter.verifyEmptyHistory('local'), /offline/);
  assert.equal(failed.session.claiming, false);
  assert.equal(failed.session.replay, false);
  const malformed = fixture({ response: null });
  await assert.rejects(malformed.adapter.verifyEmptyHistory('local'));
});

test('remote work and connection changes prevent empty confirmation', async () => {
  const active = fixture({ activity: 'working' });
  await assert.rejects(active.adapter.verifyEmptyHistory('local'));
  assert.deepEqual(active.requests.map(request => request.method), ['_x.ai/sessions/list']);
  const changed = fixture();
  const request = changed.client.request;
  changed.client.request = async (method, params) => { const result = await request(method, params); if (method === 'session/load') changed.adapter.generation++; return result; };
  await assert.rejects(changed.adapter.verifyEmptyHistory('local'), /连接已改变/);
});
