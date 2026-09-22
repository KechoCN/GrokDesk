import { redact } from './acp-client.mjs';
import { isWebUrl, safeUrl } from './grok-web-policy.mjs';

export function authProfile(value) {
  const profile = {};
  for (const field of ['email', 'firstName', 'lastName', 'teamName', 'methodId']) {
    if (typeof value?.[field] === 'string') profile[field] = value[field].slice(0, 300);
  }
  return profile;
}

// Credentials remain owned by Grok's official authenticate handler. This module
// never reads auth.json, getBearerToken, browser cookies, or API keys.
export function createGrokAuth({ getAdapter, getWindow, emit = () => {}, onAuthenticated = async () => {}, dependencies = {} }) {
  let state = { state: 'idle' }, attempt = null, requestSequence = Date.now(), disposed = false;
  const status = () => ({ ...state, ...(state.profile ? { profile: { ...state.profile } } : {}) });
  const publish = patch => { state = { ...state, ...patch }; if (!disposed) emit({ type: 'auth', state: status() }); return status(); };
  const active = operation => !disposed && attempt === operation;
  const closeWindow = operation => { if (operation?.window && !operation.window.isDestroyed()) operation.window.destroy(); };
  const request = (adapter, method, params = {}, options) => adapter.client.request(method, params, options);
  async function info() {
    const adapter = getAdapter();
    if (adapter?.status.state !== 'ready') return status();
    try {
      const profile = authProfile(await request(adapter, '_x.ai/auth/info', {}, { timeout: 15000 }));
      if (getAdapter() === adapter && !disposed) publish({ profile });
    } catch (error) {
      if (error.code !== -32601 && !attempt) publish({ error: redact(error.message).slice(0, 500) });
    }
    return status();
  }
  async function cancel() {
    const operation = attempt;
    if (!operation) return status();
    attempt = null;
    publish({ state: 'idle', url: undefined, code: undefined, mode: undefined, error: undefined });
    closeWindow(operation);
    try { await request(operation.adapter, '_x.ai/auth/cancel', { request_seq: operation.sequence }, { timeout: 10000 }); }
    catch (error) { if (!disposed) emit({ type: 'notice', message: '取消登录时引擎未确认：' + redact(error.message).slice(0, 300) }); }
    return status();
  }
  async function showLogin(operation, url) {
    if (!active(operation)) return;
    if (!isWebUrl(url)) {
      publish({ state: 'waiting', error: '此登录提供方需要使用系统浏览器，请使用 Grok 已打开的官方登录页面。' });
      return;
    }
    const parsed = safeUrl(url);
    const code = parsed.searchParams.get('user_code');
    publish({ state: 'waiting', url, code: code && /^[A-Za-z0-9-]{1,64}$/.test(code) ? code : undefined });
    const openWindow = dependencies.openWindow || (await import('./grok-web.mjs')).createAuthWindow;
    if (!active(operation)) return;
    operation.window = openWindow({ window: getWindow(), url, emit });
    operation.window.once('closed', () => { if (active(operation)) void cancel(); });
  }
  async function pollUrl(operation) {
    // get_url consumes a one-shot URL. A short retry covers the interval before
    // authenticate installs it; only this controller polls for this attempt.
    for (let tries = 0; tries < 30 && active(operation); tries++) {
      const result = await request(operation.adapter, '_x.ai/auth/get_url', {}, { timeout: 60000 });
      if (!active(operation)) return;
      if (typeof result?.auth_url === 'string') {
        publish({ mode: ['device', 'loopback', 'command'].includes(result.mode) ? result.mode : 'loopback' });
        await showLogin(operation, result.auth_url); return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  async function finish(operation, error) {
    if (!active(operation)) return;
    attempt = null;
    closeWindow(operation);
    if (error) {
      publish({ state: 'error', error: error.code === -32601 ? '当前 Grok Build 尚未提供客户端登录接口，请更新 Grok Build 或使用原版 TUI 的 /login。' : redact(error.message).slice(0, 800), url: undefined, code: undefined });
      // A timed-out request can leave the official login waiting. Scope cancellation
      // to this attempt so a user's retry cannot be cancelled by a stale request.
      void request(operation.adapter, '_x.ai/auth/cancel', { request_seq: operation.sequence }, { timeout: 5000 }).catch(() => {});
      return;
    }
    publish({ state: 'starting', error: undefined, url: undefined, code: undefined });
    try { await onAuthenticated(); await info(); publish({ state: 'success', error: undefined }); }
    catch (reconnectError) { publish({ state: 'error', error: '登录已完成，但引擎重新连接失败：' + redact(reconnectError.message).slice(0, 500) }); }
  }
  return {
    status, info, cancel,
    async start() {
      if (disposed) throw new Error('登录服务已关闭');
      if (attempt) return status();
      const adapter = getAdapter();
      if (adapter?.status.state !== 'ready') throw new Error('请先连接 Grok Build，再登录或切换账号。');
      const method = adapter.authMethods?.find(item => ['grok.com', 'oidc'].includes(item.id));
      if (!method) throw new Error('当前 Grok Build 未提供网页登录方式；请检查 API 密钥或企业登录配置。');
      const operation = { sequence: ++requestSequence, adapter, window: null };
      attempt = operation;
      publish({ state: 'starting', error: undefined, url: undefined, mode: undefined, code: undefined });
      // force_interactive deliberately does not clear the previous credential.
      // A cancelled switch therefore leaves the previous account usable.
      const authentication = request(adapter, 'authenticate', { methodId: method.id, _meta: { force_interactive: true, request_seq: operation.sequence } }, { timeout: 10 * 60 * 1000 });
      void authentication.then(() => finish(operation), error => finish(operation, error));
      void pollUrl(operation).catch(error => {
        if (active(operation)) publish({ state: 'waiting', error: '无法在客户端获取登录页面，请使用 Grok 打开的系统浏览器：' + redact(error.message).slice(0, 350) });
      });
      return status();
    },
    async openExternal() {
      if (!state.url || !isWebUrl(state.url)) throw new Error('没有可打开的官方登录链接');
      const open = dependencies.openExternal || (await import('electron')).shell.openExternal;
      await open(state.url);
    },
    async submitCode(code) {
      if (!attempt || state.mode === 'device') throw new Error('请在官方登录页面确认授权码');
      if (typeof code !== 'string' || !code.trim() || code.length > 16384) throw new Error('请输入有效的登录授权码');
      await request(attempt.adapter, '_x.ai/auth/submit_code', { code: code.trim() }, { timeout: 15000 });
    },
    async dispose() { disposed = true; await cancel(); },
  };
}
