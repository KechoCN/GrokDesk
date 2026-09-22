import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accountSnapshot, GrokAdapter } from '../electron/grok-adapter.mjs';
import { readEngineConfig, saveEngineConfig, validateEngineConfig } from '../electron/engine-settings.mjs';

test('cloud billing prefers shared percentage and period over legacy cents', () => {
  const result = accountSnapshot({ subscription_tier: 'SuperGrok', config: {
    creditUsagePercent: 32.5, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-20T00:00:00Z', end: '2026-09-27T00:00:00Z' },
    monthlyLimit: { val: 10000 }, used: { val: 9999 }, prepaidBalance: {}, onDemandUsed: { val: 125 }, isUnifiedBillingUser: true,
  } });
  assert.equal(result.subscriptionTier, 'SuperGrok');
  assert.equal(result.usedPercent, 32.5); assert.equal(result.remainingPercent, 67.5);
  assert.equal(result.prepaidBalanceCents, 0); assert.equal(result.onDemandUsedCents, 125);
  assert.equal(result.periodEnd, '2026-09-27T00:00:00Z'); assert.equal(result.sharedPool, true);
});

test('billing distinguishes missing values from zero and validates units', () => {
  const result = accountSnapshot({ config: { creditUsagePercent: '70', monthlyLimit: { val: 200 }, used: { val: 50 }, onDemandCap: { val: '300' } } });
  assert.equal(result.usedPercent, 25); assert.equal(result.onDemandCapCents, undefined);
  assert.equal(accountSnapshot({ config: {} }).usedPercent, undefined);
  assert.equal(accountSnapshot({ config: { creditUsagePercent: 130 } }).remainingPercent, 0);
  assert.equal(accountSnapshot({ config: null }).state, 'unavailable');
});

test('cloud details retain every supported balance and historical category without inventing product shares', () => {
  const result = accountSnapshot({ on_demand_enabled: false, config: { onDemandUsed: { val: 25 }, onDemandCap: { val: 100 }, prepaidBalance: {}, history: [{ billingCycle: { year: 2026, month: 8 }, includedUsed: { val: 80 }, onDemandUsed: {}, totalUsed: { val: 80 } }, { billingCycle: { year: 2026, month: 99 } }] } });
  assert.equal(result.onDemandEnabled, false);
  assert.equal(result.onDemandUsedCents, 25);
  assert.equal(result.onDemandCapCents, 100);
  assert.equal(result.prepaidBalanceCents, 0);
  assert.deepEqual(result.history, [{ year: 2026, month: 8, includedUsedCents: 80, onDemandUsedCents: 0, totalUsedCents: 80 }]);
  assert.equal(result.usedPercent, undefined);
});

test('cloud lookup uses only ACP and reports unsupported/auth/network distinctly', async () => {
  const client = new EventEmitter();
  const adapter = new GrokAdapter({ dependencies: { client, skipTerminal: true } });
  adapter.status = { state: 'ready' };
  let call;
  client.request = async (method, params) => { call = { method, params }; return { config: { creditUsagePercent: 0 } }; };
  assert.equal((await adapter.account()).remainingPercent, 100);
  assert.deepEqual(call, { method: '_x.ai/billing', params: {} });
  for (const [code, message, expected] of [[-32601, 'Unsupported', 'unavailable'], [-32000, 'Authentication required', 'auth-required'], [-32603, 'Network failed', 'error']]) {
    client.request = async () => { throw Object.assign(new Error(message), { code }); };
    assert.equal((await adapter.account()).state, expected);
  }
});

test('commands arriving before new-session response remain available', async () => {
  const client = new EventEmitter();
  const adapter = new GrokAdapter({ dependencies: { client, skipTerminal: true } });
  adapter.status = { state: 'ready' };
  client.request = async () => {
    client.emit('notification', 'session/update', { sessionId: 'engine-1', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review changes', input: { hint: 'focus' } }] } });
    return { sessionId: 'engine-1' };
  };
  const session = await adapter.open({ id: 'task-1', cwd: process.cwd() });
  assert.deepEqual(session.availableCommands, [{ name: 'review', description: 'Review changes', input: { hint: 'focus' } }]);
});

test('deletion cannot race a task running in the native TUI', async () => {
  const client = new EventEmitter();
  const adapter = new GrokAdapter({ dependencies: { client, skipTerminal: true } });
  adapter.status = { state: 'ready' };
  const session = { id: 'task-1', engineSessionId: 'engine-1', phase: 'ready', owner: null };
  adapter.sessions.set(session.id, session); adapter.engineSessions.set(session.engineSessionId, session);
  const methods = [];
  client.request = async method => { methods.push(method); return { sessions: [{ sessionId: session.engineSessionId, activity: 'working' }] }; };
  await assert.rejects(adapter.delete(session.id), /原生终端/);
  assert.deepEqual(methods, ['_x.ai/sessions/list']); assert.equal(session.claiming, false);
});

test('full configuration preserves source, backs up, and detects competing changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grokdesk-config-'));
  const environment = { GROK_HOME: directory };
  try {
    const empty = await readEngineConfig(environment);
    assert.equal(empty.exists, false);
    const original = '# Custom comment\n[unknown.future]\nvalue = "kept"\n';
    const saved = await saveEngineConfig(original, empty.revision, environment);
    assert.equal(saved.path, path.join(directory, 'config.toml'));
    const next = await saveEngineConfig(original + '\n[ui]\nscroll_speed = 25\n', saved.revision, environment);
    assert.equal(await readFile(`${saved.path}.grokdesk.bak`, 'utf8'), original);
    await assert.rejects(saveEngineConfig('[bad', next.revision, environment), /TOML/);
    assert.equal((await readEngineConfig(environment)).content, next.content);
    await writeFile(saved.path, '# External TUI update\n');
    await assert.rejects(saveEngineConfig(original, next.revision, environment), /修改/);
    assert.equal(await readFile(saved.path, 'utf8'), '# External TUI update\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('configuration validation errors do not echo secret source snippets', () => {
  assert.throws(() => validateEngineConfig('secret = "MY_TEST_SECRET\n'), error => error.message.includes('TOML') && !error.message.includes('MY_TEST_SECRET'));
});
