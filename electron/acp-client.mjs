import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

// Only groups explicitly created by this application may be signalled together.
const ownedGroups = new WeakSet();
export function spawnOwnedProcess(spawnProcess, executable, args, options) {
  const child = spawnProcess(executable, args, { ...options, detached: process.platform !== 'win32' });
  if (process.platform !== 'win32') ownedGroups.add(child);
  return child;
}

export class AcpError extends Error {
  constructor(message, code, data) { super(message); this.name = 'AcpError'; this.code = code; this.data = data; }
}

export function redact(text) {
  return String(text).replace(/(Bearer\s+)[\w.\-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}

export async function stopOwnedProcess(child) {
  if (!child || !child.pid) return;
  if (ownedGroups.has(child)) {
    ownedGroups.delete(child);
    const signalGroup = signal => { try { process.kill(-child.pid, signal); return true; } catch { return false; } };
    if (!signalGroup('SIGTERM')) return;
    const deadline = Date.now() + 1000;
    while (signalGroup(0) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (signalGroup(0)) signalGroup('SIGKILL');
    return;
  }
  if (child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => { try { child.kill(); } catch {} resolve(); });
      killer.once('close', resolve);
    });
  } else { try { child.kill('SIGTERM'); } catch {} }
}

/** JSON-RPC over newline-delimited UTF-8. Never logs request payloads or resends requests. */
export class AcpClient extends EventEmitter {
  constructor({ spawnProcess = spawn } = {}) { super(); this.spawnProcess = spawnProcess; this.connection = null; this.nextId = 0; this.startGeneration = 0; }
  get running() { return !!this.connection && !this.connection.closed; }

  async start(executable, args, { cwd, env } = {}) {
    const generation = ++this.startGeneration;
    await this.stop(false);
    if (generation !== this.startGeneration) throw new Error('Grok connection startup was cancelled');
    const child = spawnOwnedProcess(this.spawnProcess, executable, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const connection = { child, pending: new Map(), buffer: '', closed: false };
    this.connection = connection;
    child.stdin.on('error', error => this.fail(connection, error));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (this.connection !== connection || connection.closed) return;
      connection.buffer += data;
      if (connection.buffer.length > 32 * 1024 * 1024) {
        this.fail(connection, new Error('ACP frame exceeded the 32 MiB limit'));
        void this.stop();
        return;
      }
      let end;
      while ((end = connection.buffer.indexOf('\n')) >= 0) {
        const line = connection.buffer.slice(0, end).trim();
        connection.buffer = connection.buffer.slice(end + 1);
        if (!line) continue;
        try { this.dispatch(connection, JSON.parse(line)); }
        catch { this.emit('diagnostic', 'Ignored malformed ACP frame'); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => {
      if (this.connection === connection) this.emit('diagnostic', redact(data).slice(0, 2000));
    });
    child.once('error', error => this.fail(connection, error));
    // "close" waits for stdout to drain; "exit" can race a final JSON-RPC response.
    child.once('close', (code, signal) => {
      this.fail(connection, new Error(`Grok connection closed (${code ?? signal ?? 'unknown'})`));
      if (this.connection === connection) this.emit('disconnected', { code, signal });
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  }

  request(method, params, { timeout = 45000, signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Request cancelled'));
    const connection = this.connection;
    if (!connection || connection.closed) return Promise.reject(new Error('Grok is disconnected'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = connection.pending.get(id);
        if (!pending) return;
        connection.pending.delete(id);
        clearTimeout(pending.timer);
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(signal.reason ?? new Error('Request cancelled'));
      const timer = setTimeout(() => {
        const error = new Error(`${method} timed out; it has not been resent`); error.code = 'ETIMEDOUT'; finish(error);
      }, timeout);
      connection.pending.set(id, { finish, timer });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.write(connection, { jsonrpc: '2.0', id, method, params });
      } catch (error) { finish(error); return; }
      // The pipe write already happened. A persistence/UI observer cannot undo it
      // or turn it into a failed-before-send request that the caller might repeat.
      try { this.emit('requestSent', { id, method, sessionId: typeof params?.sessionId === 'string' ? params.sessionId : undefined }); }
      catch (error) { try { this.emit('diagnostic', `Request observer failed after submission: ${redact(error.message)}`); } catch {} }
    });
  }

  notify(method, params) {
    const connection = this.connection;
    if (!connection || connection.closed) throw new Error('Grok is disconnected');
    this.write(connection, { jsonrpc: '2.0', method, params });
  }

  write(connection, message) {
    if (this.connection !== connection || connection.closed || connection.child.stdin.destroyed) throw new Error('Grok connection is closed');
    connection.child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) this.fail(connection, error); });
  }

  dispatch(connection, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const hasId = typeof message.id === 'string' || typeof message.id === 'number';
    if (typeof message.method === 'string') {
      if (!hasId) { this.emit('notification', message.method, message.params); return; }
      // Response closures are bound to the originating connection, including string request IDs.
      let answered = false;
      const respond = (result, error) => {
        if (answered || this.connection !== connection || connection.closed) return false;
        answered = true;
        this.write(connection, { jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) });
        return true;
      };
      if (this.listenerCount('request') === 0) respond(null, { code: -32601, message: 'Client method not supported' });
      else this.emit('request', { id: message.id, method: message.method, params: message.params, respond });
      return;
    }
    if (!hasId) return;
    const pending = connection.pending.get(message.id);
    if (!pending) return;
    const error = message.error ? new AcpError(redact(message.error.message ?? 'ACP request failed'), message.error.code, message.error.data) : null;
    pending.finish(error, message.result);
  }

  fail(connection, error) {
    connection.closed = true;
    for (const pending of [...connection.pending.values()]) pending.finish(error);
  }

  async stop(invalidateStart = true) {
    if (invalidateStart) this.startGeneration++;
    const previous = this.connection;
    this.connection = null;
    if (!previous) return;
    this.fail(previous, new Error('Grok connection stopped'));
    previous.child.stdin.destroy();
    await stopOwnedProcess(previous.child);
  }
}
