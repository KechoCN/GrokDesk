import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isWebUrl, isGrokUrl, isExternalUrl, callbackFromAuthUrl, isAuthCallback, webBounds, normalizeWebProfiles } from '../electron/grok-web-policy.mjs';
import { createGrokAuth, authProfile } from '../electron/grok-auth.mjs';

test('official web origins cannot be confused with subdomains, credentials or executable URLs', () => {
  assert.equal(isGrokUrl('https://grok.com/c/123'), true);
  for (const url of ['http://grok.com', 'https://grok.com.attacker.test', 'https://grok.com@attacker.test', 'https://attacker.test@grok.com', 'file:///C:/secret', 'javascript:alert(1)', 'https://grok.com:444']) assert.equal(isWebUrl(url), false, url);
  assert.equal(isWebUrl('https://accounts.google.com/o/oauth2/auth'), true);
  assert.equal(isExternalUrl('ms-settings:privacy'), false);
  assert.equal(isExternalUrl('https://docs.x.ai/build'), true);
});

test('OAuth callback allowlist is limited to the exact engine loopback endpoint', () => {
  const callback = callbackFromAuthUrl('https://auth.x.ai/oauth2/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A48211%2Fcallback');
  assert.equal(callback, 'http://127.0.0.1:48211/callback');
  assert.equal(isAuthCallback('http://127.0.0.1:48211/callback?code=mock&state=mock', callback), true);
  assert.equal(isAuthCallback('http://127.0.0.1:48212/callback?code=mock', callback), false);
  assert.equal(isAuthCallback('http://127.0.0.1:48211/admin', callback), false);
  assert.equal(callbackFromAuthUrl('https://auth.x.ai/authorize?redirect_uri=https%3A%2F%2Fevil.test'), null);
  assert.equal(callbackFromAuthUrl('https://evil.test/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A48211%2Fcallback'), null);
});

test('native view bounds stay inside the application content area during resize', () => {
  assert.deepEqual(webBounds({ x: -40, y: 70, width: 400, height: 800 }, [1024, 768]), { x: 0, y: 70, width: 360, height: 698 });
  assert.deepEqual(webBounds({ x: 2000, y: 900, width: 100, height: 100 }, [1024, 768]), { x: 1024, y: 768, width: 0, height: 0 });
  assert.throws(() => webBounds({ x: NaN, y: 0, width: 1, height: 1 }, [100, 100]));
});

test('profile metadata cannot choose filesystem paths or duplicate cookie partitions', () => {
  assert.deepEqual(normalizeWebProfiles({ profiles: [{ id: '../../other', label: 'bad' }, { id: 'good', label: ' A ' }, { id: 'good', label: 'B' }], activeProfileId: '../../other' }), { profiles: [{ id: 'good', label: 'A' }], activeProfileId: 'good' });
  assert.equal(normalizeWebProfiles(null).activeProfileId, 'default');
});

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function authFixture() {
  const authentication = deferred(), url = deferred(), calls = [], events = [], windows = [];
  const adapter = { status: { state: 'ready' }, authMethods: [{ id: 'grok.com' }], client: { request(method, params) {
    calls.push({ method, params });
    if (method === 'authenticate') return authentication.promise;
    if (method === '_x.ai/auth/get_url') return url.promise;
    return Promise.resolve(method === '_x.ai/auth/info' ? { email: 'test@example.test', key: 'NEVER_EXPOSE', access_token: 'NEVER_EXPOSE' } : {});
  } } };
  let finished = 0;
  const controller = createGrokAuth({ getAdapter: () => adapter, getWindow: () => null, emit: event => events.push(event), onAuthenticated: async () => { finished++; }, dependencies: { openWindow: () => {
    const window = new EventEmitter(); window.destroyed = false; window.isDestroyed = () => window.destroyed; window.destroy = () => { window.destroyed = true; window.emit('closed'); }; windows.push(window); return window;
  } } });
  return { controller, adapter, authentication, url, calls, events, windows, get finished() { return finished; } };
}

test('sign-in uses advertised official methods, never clears old credentials, and reconnects only after success', async () => {
  const fixture = authFixture();
  assert.equal((await fixture.controller.start()).state, 'starting');
  await fixture.controller.start();
  assert.equal(fixture.calls.filter(call => call.method === 'authenticate').length, 1);
  const parameters = fixture.calls[0].params;
  assert.equal(parameters.methodId, 'grok.com');
  assert.equal(parameters._meta.force_interactive, true);
  assert.equal(parameters._meta.reauth, undefined);
  fixture.url.resolve({ auth_url: 'https://auth.x.ai/device?user_code=ABCD-EFGH', mode: 'device' });
  await tick();
  assert.equal(fixture.controller.status().code, 'ABCD-EFGH');
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.finished, 0);
  fixture.authentication.resolve({}); await tick(); await tick();
  assert.equal(fixture.controller.status().state, 'success');
  assert.equal(fixture.finished, 1);
  assert.equal(fixture.windows[0].destroyed, true);
  assert.deepEqual(fixture.controller.status().profile, { email: 'test@example.test' });
  assert.equal(JSON.stringify(fixture.events).includes('NEVER_EXPOSE'), false);
});

test('cancel scopes the official request and ignores late authentication completion', async () => {
  const fixture = authFixture();
  await fixture.controller.start();
  const sequence = fixture.calls[0].params._meta.request_seq;
  await fixture.controller.cancel();
  assert.equal(fixture.calls.find(call => call.method === '_x.ai/auth/cancel').params.request_seq, sequence);
  fixture.url.resolve({ auth_url: 'https://auth.x.ai/device', mode: 'device' });
  fixture.authentication.resolve({}); await tick();
  assert.equal(fixture.controller.status().state, 'idle');
  assert.equal(fixture.finished, 0);
  assert.equal(fixture.windows.length, 0);
});

test('authentication refuses to invent a login method and keeps profile output allowlisted', async () => {
  const fixture = authFixture(); fixture.adapter.authMethods = [{ id: 'xai.api_key' }];
  await assert.rejects(fixture.controller.start(), /未提供网页登录/);
  assert.deepEqual(authProfile({ email: 'a@example.test', firstName: 'A', key: 'secret', refreshToken: 'secret' }), { email: 'a@example.test', firstName: 'A' });
});
