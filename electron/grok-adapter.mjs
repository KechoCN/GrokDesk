import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rmdir, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AcpClient, redact, spawnOwnedProcess, stopOwnedProcess } from './acp-client.mjs';
import { promptCapabilities } from './prompt-capabilities.mjs';
import { appVersion, desktopEnvironment, engineFilename, findEngineExecutable, grokHome, sameDirectory, terminalEnvironment } from './platform.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_TERMINAL = 2 * 1024 * 1024;
const busy = phase => ['running', 'waiting', 'cancelling', 'connecting'].includes(phase);
const terminalReply = data => /^\x1b\[\??[\d;]*[Rcn]$/.test(data) || /^\x1b\](?:10|11|12);rgb:[0-9a-f/]+(?:\x07|\x1b\\)$/i.test(data);
const stringValue = value => typeof value === 'string' ? value : typeof value?.value === 'string' ? value.value : null;

export function commandCatalog(commands) {
  return Array.isArray(commands) ? commands.filter(command => typeof command?.name === 'string' && command.name.trim()).map(command => ({
    name: command.name, description: typeof command.description === 'string' ? command.description : '',
    ...(typeof command.input?.hint === 'string' ? { input: { hint: command.input.hint } } : {}),
  })) : [];
}

// Official xai-org/grok-build extensions/billing.rs: config uses camelCase,
// top-level subscription_tier uses snake_case. All monetary fields are USD cents.
export function accountSnapshot(result, checkedAt = new Date().toISOString()) {
  const config = result?.config;
  const snapshot = { state: config && typeof config === 'object' ? 'ready' : 'unavailable', source: 'grok-cloud', checkedAt };
  if (typeof result?.subscription_tier === 'string') snapshot.subscriptionTier = result.subscription_tier;
  if (!config || typeof config !== 'object') { snapshot.error = '当前 Grok 账号没有返回云端订阅额度。'; return snapshot; }
  const cents = value => value && typeof value === 'object' && !Array.isArray(value) && (value.val === undefined || Number.isSafeInteger(value.val)) && (value.val ?? 0) >= 0 ? value.val ?? 0 : undefined;
  for (const [field, key] of [['includedLimitCents', 'monthlyLimit'], ['includedUsedCents', 'used'], ['prepaidBalanceCents', 'prepaidBalance'], ['onDemandUsedCents', 'onDemandUsed'], ['onDemandCapCents', 'onDemandCap']]) {
    const value = cents(config[key]); if (value !== undefined) snapshot[field] = value;
  }
  const percent = typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent) && config.creditUsagePercent >= 0
    ? config.creditUsagePercent : snapshot.includedLimitCents > 0 && snapshot.includedUsedCents !== undefined ? snapshot.includedUsedCents / snapshot.includedLimitCents * 100 : undefined;
  if (percent !== undefined) { snapshot.usedPercent = percent; snapshot.remainingPercent = Math.max(0, 100 - percent); }
  for (const [field, value] of [['periodStart', config.currentPeriod?.start ?? config.billingPeriodStart], ['periodEnd', config.currentPeriod?.end ?? config.billingPeriodEnd]]) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) snapshot[field] = value;
  }
  if (typeof config.currentPeriod?.type === 'string') snapshot.periodType = config.currentPeriod.type;
  if (typeof config.isUnifiedBillingUser === 'boolean') snapshot.sharedPool = config.isUnifiedBillingUser;
  if (typeof result.on_demand_enabled === 'boolean') snapshot.onDemandEnabled = result.on_demand_enabled;
  if (Array.isArray(config.history)) snapshot.history = config.history.filter(item => Number.isInteger(item?.billingCycle?.year) && Number.isInteger(item?.billingCycle?.month) && item.billingCycle.month >= 1 && item.billingCycle.month <= 12).slice(-12).map(item => ({
    year: item.billingCycle.year, month: item.billingCycle.month,
    ...Object.fromEntries([['includedUsedCents', item.includedUsed], ['onDemandUsedCents', item.onDemandUsed], ['totalUsedCents', item.totalUsed]].flatMap(([key, value]) => cents(value) === undefined ? [] : [[key, cents(value)]])),
  }));
  return snapshot;
}

/** Keep Grok's existing authentication, HOME, GROK_HOME and credential environment intact. */
export function inheritedEnvironment(source = process.env, additionalPath = []) {
  return { ...desktopEnvironment(source, { additionalPath }), GROK_DISABLE_AUTOUPDATER: '1' };
}

export function findEngine(override, environment = process.env) {
  return findEngineExecutable(override, environment);
}

function selectOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.flatMap(option => Array.isArray(option?.options) ? selectOptions(option.options)
    : typeof option?.value === 'string' ? [{ value: option.value, name: option.name || option.value }] : []);
}

export function sessionCatalog(result, previous = {}) {
  const configOptions = Array.isArray(result?.configOptions) ? result.configOptions.filter(option => typeof option?.id === 'string').map(option => ({
    id: option.id, name: option.name || option.id, category: option.category, type: option.type || 'select',
    currentValue: stringValue(option.currentValue) ?? '', options: selectOptions(option.options),
  })) : previous.configOptions || [];
  const modelsState = result?.models || (result?.availableModels ? result : result?._meta?.modelState);
  const currentModelId = stringValue(modelsState?.currentModelId) || configOptions.find(option => option.id === 'model')?.currentValue || previous.currentModelId || null;
  const currentEffort = configOptions.find(option => option.id === 'reasoning_effort')?.currentValue ?? previous.currentEffort ?? null;
  const reasoning = configOptions.find(option => option.id === 'reasoning_effort')?.options ?? [];
  const models = Array.isArray(modelsState?.availableModels) ? modelsState.availableModels.filter(model => typeof model?.modelId === 'string').map(model => {
    const advertised = model._meta?.reasoningEfforts;
    const efforts = Array.isArray(advertised) ? advertised.map(item => ({ id: typeof item === 'string' ? item : item?.id, label: item?.label || item?.name || (typeof item === 'string' ? item : item?.id) })).filter(item => item.id)
      : model.modelId === currentModelId ? reasoning.map(option => ({ id: option.value, label: option.name })) : [];
    return { id: model.modelId, name: model.name || model.modelId, efforts };
  }) : previous.models || [];
  return { models, configOptions, currentModelId, currentEffort };
}

/** Owns its leader, ACP client and PTYs. No credential file is read or copied. */
export class GrokAdapter {
  constructor({ emit = () => {}, dependencies = {} } = {}) {
    this.emit = emit;
    this.spawnProcess = dependencies.spawnProcess || spawn;
    this.ptyLoader = dependencies.ptyLoader || (() => import('node-pty'));
    this.client = dependencies.client || new AcpClient();
    this.skipLeader = dependencies.skipLeader || false;
    this.skipTerminal = dependencies.skipTerminal || false;
    this.sessions = new Map();
    this.engineSessions = new Map();
    this.terminalSequences = new Map();
    this.opening = new Map();
    this.permissions = new Map();
    this.pendingCommands = new Map();
    this.generation = 0;
    this.startEpoch = 0;
    this.status = { state: 'discovering', auth: 'unknown' };
    this.capabilities = {};
    this.rosterSupported = undefined;
    this.client.on('notification', (method, params) => this.onNotification(method, params));
    this.client.on('request', request => this.onRequest(request));
    this.client.on('requestSent', request => {
      if (request.method !== 'session/prompt') return;
      const session = this.engineSessions.get(request.sessionId);
      if (session?.owner === 'gui') this.emit({ type: 'submitted', conversationId: session.id });
    });
    this.client.on('diagnostic', message => this.emit({ type: 'diagnostic', message: redact(message) }));
    this.client.on('disconnected', () => {
      if (this.disposing) return;
      this.setStatus({ ...this.status, state: 'error', error: 'Grok connection was lost. Reconnect to recover; tasks are never automatically resent.' });
      for (const session of this.sessions.values()) {
        if (session.owner) session.owner = 'unknown';
        this.phase(session, 'error', '连接丢失；请重新连接恢复，任务不会自动重发。');
      }
      this.cancelPermissions();
    });
  }

  setStatus(status) { this.status = status; this.emit({ type: 'engine', status }); return status; }
  phase(session, phase, error) {
    session.phase = phase;
    this.emit({ type: 'phase', conversationId: session.id, phase, ...(error ? { error: redact(error) } : {}) });
  }
  snapshot(session) {
    return { id: session.id, engineSessionId: session.engineSessionId, cwd: session.cwd, models: session.models || [],
      availableCommands: session.commands || [],
      configOptions: session.configOptions || [], currentModelId: session.currentModelId ?? null, currentEffort: session.currentEffort ?? null,
      phase: session.phase, supportsImages: this.capabilities.promptCapabilities?.image === true,
      supportsEmbeddedContext: this.capabilities.promptCapabilities?.embeddedContext === true };
  }
  publishSession(session) { const snapshot = this.snapshot(session); this.emit({ type: 'session', conversationId: session.id, snapshot }); return snapshot; }
  get(id) { const session = this.sessions.get(id); if (!session) throw new Error('会话尚未连接，请先打开会话。'); return session; }

  async start({ enginePath, cwd }) {
    const startEpoch = ++this.startEpoch;
    await this.dispose(false);
    if (startEpoch !== this.startEpoch) throw new Error('Grok startup was cancelled');
    this.disposing = false;
    const generation = ++this.generation;
    const ensureActive = () => { if (generation !== this.generation || this.disposing || startEpoch !== this.startEpoch) throw new Error('Grok startup was cancelled'); };
    if (!path.isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('工作目录不存在，请重新定位；不会自动创建替代目录。');
    const executable = findEngine(enginePath);
    if (!executable) return this.setStatus({ state: 'missing', auth: 'unknown', error: `未找到可执行的 Grok Build。请先安装，或在设置中选择 ${engineFilename()}。` });
    this.executable = executable;
    this.environment = inheritedEnvironment(process.env, [path.dirname(executable)]);
    this.rosterSupported = undefined;
    this.setStatus({ state: 'connecting', path: executable, auth: 'inherited' });
    // Unique socket keeps this app away from the user's existing leader and other app instances.
    // macOS Unix sockets have a short path limit. A private directory under
    // /tmp also avoids long/unicode home paths and shared leader collisions.
    const socketDirectory = process.platform === 'win32' ? grokHome(this.environment) : await mkdtemp('/tmp/grokdesk-');
    if (process.platform === 'win32') await mkdir(socketDirectory, { recursive: true });
    try { ensureActive(); }
    catch (error) { if (process.platform !== 'win32') await rmdir(socketDirectory).catch(() => {}); throw error; }
    if (process.platform !== 'win32') this.socketDirectory = socketDirectory;
    this.socket = path.join(socketDirectory, `leader-gd-${process.pid}-${randomUUID().slice(0, 12)}.sock`);
    // Grok's reconnect/spawn path forwards the socket through this environment
    // variable. The CLI flag alone does not keep all native descendants bound.
    this.environment.GROK_LEADER_SOCKET = this.socket;
    try {
      if (!this.skipLeader) {
        this.leader = spawnOwnedProcess(this.spawnProcess, executable, ['agent', 'leader', '--no-exit-on-disconnect', '--relay-on-demand', '--no-auto-update', '--leader-socket', this.socket],
          { cwd, env: this.environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        this.leader.stdout.resume();
        this.leader.stderr.setEncoding('utf8');
        this.leader.stderr.on('data', data => this.emit({ type: 'diagnostic', message: redact(data).slice(0, 2000) }));
        await new Promise((resolve, reject) => { this.leader.once('spawn', resolve); this.leader.once('error', reject); });
        await delay(700);
        ensureActive();
      }
      let hello;
      for (let attempt = 0; attempt < 3; attempt++) {
        ensureActive();
        if (this.leader && this.leader.exitCode !== null) throw new Error(`Grok leader exited (${this.leader.exitCode})`);
        try {
          await this.client.start(executable, ['agent', '--leader', '--leader-socket', this.socket, 'stdio'], { cwd, env: this.environment });
          ensureActive();
          hello = await this.client.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'GrokDesk', version: appVersion },
            _meta: { 'x.ai/userMessageEcho': false },
          }, { timeout: 45000 });
          ensureActive();
          break;
        } catch (error) { ensureActive(); if (attempt === 2) throw error; await delay(350 * (attempt + 1)); }
      }
      if (hello?.protocolVersion !== 1) throw new Error('Grok returned an unsupported ACP protocol version');
      this.capabilities = { ...hello.agentCapabilities, promptCapabilities: promptCapabilities(hello) };
      this.authMethods = hello.authMethods || [];
      return this.setStatus({ state: 'ready', path: executable, version: hello._meta?.agentVersion, auth: 'inherited' });
    } catch (error) {
      if (generation !== this.generation || this.disposing || startEpoch !== this.startEpoch) throw error;
      await this.dispose(false);
      if (startEpoch !== this.startEpoch) throw error;
      this.disposing = false;
      return this.setStatus({ state: 'error', path: executable, auth: /auth|login|sign.in/i.test(error.message) ? 'required' : 'unknown', error: redact(error.message) });
    }
  }

  async open(input) {
    if (this.opening.has(input.id)) return this.opening.get(input.id);
    const work = this.openSession(input);
    this.opening.set(input.id, work);
    try { return await work; } finally { this.opening.delete(input.id); }
  }

  async openSession({ id, cwd, engineSessionId }) {
    const generation = this.generation;
    if (this.status.state !== 'ready') throw new Error(this.status.error || 'Grok尚未连接。');
    if (typeof id !== 'string' || !id || !path.isAbsolute(cwd)) throw new Error('Invalid conversation or working directory');
    await access(cwd);
    if (generation !== this.generation || this.disposing) throw new Error('Connection changed while opening the session');
    if (!statSync(cwd).isDirectory()) throw new Error('工作路径不是文件夹。');
    const previous = this.sessions.get(id);
    if (previous) {
      if (!sameDirectory(previous.cwd, cwd) || (engineSessionId && engineSessionId !== previous.engineSessionId)) throw new Error('不能将已连接会话静默切换到其他目录或身份。');
      if (!previous.terminal && !this.skipTerminal && !busy(previous.phase)) await this.startTerminal(previous);
      if (generation !== this.generation || this.disposing) throw new Error('Connection changed while opening the session');
      return this.snapshot(previous);
    }
    const session = { id, cwd, engineSessionId, phase: 'connecting', owner: null, replay: !!engineSessionId, terminalData: '', terminalSequence: this.terminalSequences.get(id) || 0, terminalTruncated: false };
    if (engineSessionId && this.engineSessions.has(engineSessionId)) throw new Error('同一个引擎会话已经在另一个对话中打开。');
    this.sessions.set(id, session);
    if (engineSessionId) this.engineSessions.set(engineSessionId, session);
    this.phase(session, 'connecting');
    try {
      if (engineSessionId && this.capabilities.loadSession !== true) throw new Error('当前引擎没有声明支持恢复历史会话。');
      const result = await this.client.request(engineSessionId ? 'session/load' : 'session/new', {
        ...(engineSessionId ? { sessionId: engineSessionId } : {}), cwd, mcpServers: [],
      }, { timeout: 120000 });
      if (generation !== this.generation) throw new Error('Connection changed while opening the session');
      session.engineSessionId = engineSessionId || result?.sessionId;
      if (!session.engineSessionId) throw new Error('Grok did not return a session ID');
      this.engineSessions.set(session.engineSessionId, session);
      Object.assign(session, sessionCatalog(result));
      session.commands = this.pendingCommands.get(session.engineSessionId) || (Array.isArray(result?.availableCommands) ? commandCatalog(result.availableCommands) : session.commands || []);
      this.pendingCommands.delete(session.engineSessionId);
      session.replay = false;
      this.phase(session, 'ready');
      this.publishSession(session); // Persist the real engine ID even if the terminal cannot start.
      if (!this.skipTerminal) {
        try { await this.startTerminal(session); }
        catch (error) { this.emit({ type: 'diagnostic', message: `Terminal failed: ${redact(error.message)}` }); }
      }
      if (generation !== this.generation || this.disposing) throw new Error('Connection changed while opening the session');
      return this.snapshot(session);
    } catch (error) {
      session.replay = false;
      if (generation === this.generation && this.sessions.get(id) === session) {
        this.phase(session, 'error', error.message);
        this.sessions.delete(id);
        if (session.engineSessionId) this.engineSessions.delete(session.engineSessionId);
      }
      throw error; // Never create a replacement after an unsuccessful history load.
    }
  }

  async prompt(id, blocks) {
    const session = this.get(id);
    const generation = this.generation;
    if (this.status.state !== 'ready') throw new Error('连接未就绪，请先重新连接并检查任务状态。');
    if (busy(session.phase) || session.owner || session.claiming) throw new Error('此会话仍在执行或由原生终端控制，请等待完成后再从输入框发送。');
    if (!Array.isArray(blocks) || !blocks.length || blocks.some(block => !['text', 'image', 'resource'].includes(block?.type))) throw new Error('不支持的消息内容。');
    if (blocks.some(block => block.type === 'image') && !this.capabilities.promptCapabilities?.image) throw new Error('当前Grok连接不支持通过ACP传入图片。');
    if (blocks.some(block => block.type === 'resource') && !this.capabilities.promptCapabilities?.embeddedContext) throw new Error('当前Grok连接不支持嵌入文件内容。');
    await this.claimIdle(session);
    session.owner = 'gui'; session.claiming = false;
    this.phase(session, 'running');
    try {
      const result = await this.client.request('session/prompt', { sessionId: session.engineSessionId, prompt: blocks }, { timeout: 30 * 60 * 1000 });
      if (generation !== this.generation || this.sessions.get(id) !== session) throw new Error('Connection changed while running the task; it has not been resent');
      session.owner = null;
      this.cancelPermissions(id);
      this.phase(session, 'ready');
      return result;
    } catch (error) {
      if (generation !== this.generation || this.sessions.get(id) !== session) throw error;
      this.cancelPermissions(id);
      if (error.code === 'ETIMEDOUT') {
        try { this.client.notify('session/cancel', { sessionId: session.engineSessionId }); } catch {}
        session.owner = 'unknown'; this.phase(session, 'cancelling', error.message);
      } else { session.owner = this.status.state === 'ready' ? null : 'unknown'; this.phase(session, 'error', error.message); }
      if (/auth|sign.in|login/i.test(error.message)) this.setStatus({ ...this.status, auth: 'required', error: redact(error.message) });
      throw error;
    }
  }

  cancel(id) {
    const session = this.get(id);
    if (!busy(session.phase) && !session.owner) return;
    this.cancelPermissions(id);
    this.client.notify('session/cancel', { sessionId: session.engineSessionId });
    this.phase(session, 'cancelling');
  }

  async setConfig(id, configId, value) {
    const session = this.get(id);
    const generation = this.generation;
    if (busy(session.phase) || session.owner || session.claiming) throw new Error('任务进行中，请完成后再修改模型或思考强度。');
    const config = session.configOptions.find(option => option.id === configId);
    if (!config || config.type !== 'select' || !config.options.some(option => option.value === value)) throw new Error('引擎没有提供这个配置选项。');
    await this.claimIdle(session);
    try {
      // Values and config IDs come exclusively from the engine's advertised catalog.
      const result = await this.client.request('session/set_config_option', { sessionId: session.engineSessionId, configId, value }, { timeout: 20000 });
      if (generation !== this.generation || this.sessions.get(id) !== session) throw new Error('Connection changed while setting configuration');
      if (Array.isArray(result?.configOptions)) Object.assign(session, sessionCatalog(result, session));
      else {
        config.currentValue = value;
        if (configId === 'model') session.currentModelId = value;
        if (configId === 'reasoning_effort') session.currentEffort = value;
      }
      return this.publishSession(session);
    } finally { session.claiming = false; }
  }

  async claimIdle(session) {
    if (session.claiming || session.owner || busy(session.phase)) throw new Error('此会话仍在执行，请等待完成。');
    session.claiming = true;
    const generation = this.generation;
    try {
      if (this.rosterSupported !== false) {
        try {
          // This extension reports live actor activity; session/state only reports
          // persisted metadata and cannot establish that a turn is idle.
          const response = await this.client.request('_x.ai/sessions/list', {}, { timeout: 15000 });
          const result = response?.result ?? response;
          if (!Array.isArray(result?.sessions)) throw new Error('Grok 未返回可核实的会话活动状态。');
          this.rosterSupported = true;
          const entry = result.sessions.find(entry => entry.sessionId === session.engineSessionId);
          if (!entry || !['working', 'needs_input', 'idle', 'completed'].includes(entry.activity)) throw new Error('无法确认此会话当前是否空闲。');
          this.applyActivity(session, entry.activity);
        } catch (error) {
          if (error.code !== -32601) throw error;
          this.rosterSupported = false;
        }
      }
      if (generation !== this.generation || this.status.state !== 'ready') throw new Error('连接已改变，请重新打开会话。');
      if (this.rosterSupported === false && session.terminalTouched) throw new Error('此版本 Grok 不提供实时活动查询；请先在原生终端完成任务，再重新连接。');
      if (session.owner || busy(session.phase)) throw new Error('此会话仍由原生终端执行，请等待完成。');
    } catch (error) { session.claiming = false; throw error; }
  }

  applyActivity(session, activity) {
    if (session.replay || session.owner === 'gui') return;
    if (activity === 'working' || activity === 'needs_input') {
      session.owner = 'terminal'; this.phase(session, activity === 'needs_input' ? 'waiting' : 'running');
    } else if (activity === 'idle' || activity === 'completed') {
      session.owner = null; session.terminalTouched = false; session.queuedPrompts = 0;
      this.phase(session, 'ready');
    } else if (activity === 'dead') {
      session.owner = 'unknown'; this.phase(session, 'error', '原生会话已退出，任务状态需要重新确认。');
    }
  }

  async usage(id) {
    const session = this.get(id);
    return this.capture(['usage', session.engineSessionId], session.cwd);
  }

  async verifyEmptyHistory(id) {
    const session = this.get(id);
    const generation = this.generation;
    if (this.capabilities.loadSession !== true) throw new Error('当前引擎不能重新验证历史，空任务清理已保留待重试。');
    await this.claimIdle(session);
    const verification = { hasContent: false, uncertain: false };
    session.emptyHistoryVerification = verification;
    session.replay = true;
    try {
      // open() may reuse an in-memory session. Force the read-only ACP load so
      // history written by another client is replayed before any automatic delete.
      const result = await this.client.request('session/load', {
        sessionId: session.engineSessionId, cwd: session.cwd, mcpServers: [],
      }, { timeout: 25000 });
      if (generation !== this.generation || this.disposing || this.status.state !== 'ready' || this.sessions.get(id) !== session) throw new Error('连接已改变，无法确认历史是否为空。');
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('引擎未确认历史加载完成，空任务已保留。');
      return !verification.hasContent && !verification.uncertain;
    } finally {
      delete session.emptyHistoryVerification;
      session.replay = false;
      session.claiming = false;
    }
  }

  async account() {
    const checkedAt = new Date().toISOString();
    if (this.status.state !== 'ready') return { state: 'unavailable', source: 'grok-cloud', checkedAt, error: '请先连接 Grok，以读取云端订阅和用量。' };
    try {
      return accountSnapshot(await this.client.request('_x.ai/billing', {}, { timeout: 25000 }), checkedAt);
    } catch (error) {
      const detail = `${error.message || ''} ${typeof error.data === 'string' ? error.data : ''}`;
      const authRequired = /auth|sign.in|login|grok\.com/i.test(detail);
      return { state: error.code === -32601 ? 'unavailable' : authRequired ? 'auth-required' : 'error', source: 'grok-cloud', checkedAt,
        error: error.code === -32601 ? '当前 Grok 版本尚未提供云端用量接口，请更新 Grok Build。' : authRequired ? '请通过 Grok 原版 TUI 登录与 Grok 网页相同的账号；API 密钥不能读取网页订阅。' : redact(detail).trim().slice(0, 500) };
    }
  }

  async listSessions() {
    if (!this.capabilities.sessionCapabilities?.list) return [];
    const result = await this.client.request('session/list', {}, { timeout: 20000 });
    return Array.isArray(result?.sessions) ? result.sessions.filter(session => typeof session.sessionId === 'string' && typeof session.cwd === 'string').map(session => ({
      sessionId: session.sessionId, cwd: session.cwd, updatedAt: session.updatedAt,
      ...(typeof session.title === 'string' ? { title: session.title } : {}),
    })) : [];
  }

  async rename(id, title) {
    const session = this.get(id);
    const generation = this.generation;
    if (typeof title !== 'string' || !title.trim() || title.length > 300) throw new Error('Invalid title');
    await this.client.request('_x.ai/session/rename', { sessionId: session.engineSessionId, title: title.trim() }, { timeout: 15000 });
    if (generation !== this.generation || this.sessions.get(id) !== session) throw new Error('Connection changed while renaming the session');
  }

  async delete(id) {
    const session = this.get(id);
    const generation = this.generation;
    if (busy(session.phase) || session.owner) throw new Error('请先停止正在执行的会话。');
    await this.claimIdle(session);
    try {
      await this.client.request('_x.ai/session/delete', { sessionId: session.engineSessionId }, { timeout: 20000 });
      if (generation !== this.generation || this.sessions.get(id) !== session) throw new Error('Connection changed while deleting the session');
      await this.stopTerminal(session);
      this.sessions.delete(id); this.engineSessions.delete(session.engineSessionId);
    } finally { session.claiming = false; }
  }

  capture(args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawnOwnedProcess(this.spawnProcess, this.executable, args, { cwd, env: this.environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { void stopOwnedProcess(child); reject(new Error('Grok command timed out')); }, 30000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', data => { stdout = (stdout + data).slice(-2 * 1024 * 1024); });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(redact(stdout)) : reject(new Error(redact(stderr || `Grok exited ${code}`))); });
    });
  }

  async startTerminal(session) {
    if (session.terminal) return;
    const generation = this.generation;
    const module = await this.ptyLoader();
    if (generation !== this.generation || this.disposing || this.sessions.get(session.id) !== session) throw new Error('Terminal startup was cancelled');
    const pty = module.spawn ? module : module.default;
    const terminal = pty.spawn(this.executable, ['--leader', '--leader-socket', this.socket, '--resume', session.engineSessionId, '--cwd', session.cwd], {
      name: 'xterm-256color', cols: 110, rows: 30, cwd: session.cwd, env: terminalEnvironment(this.environment),
    });
    session.terminal = terminal;
    session.terminalDead = false;
    if (session.terminalSequence > 0) {
      session.terminalData = '\x1bc';
      this.terminalSequences.set(session.id, ++session.terminalSequence);
      this.emit({ type: 'terminal', conversationId: session.id, sequence: session.terminalSequence, data: '\x1bc' });
    } else session.terminalData = '';
    session.terminalTruncated = false;
    terminal.onData(data => {
      if (session.terminal !== terminal || session.terminalDead) return;
      session.terminalData += data;
      if (session.terminalData.length > MAX_TERMINAL) { session.terminalData = session.terminalData.slice(-MAX_TERMINAL); session.terminalTruncated = true; }
      const sequence = ++session.terminalSequence;
      this.terminalSequences.set(session.id, sequence);
      this.emit({ type: 'terminal', conversationId: session.id, sequence, data });
    });
    terminal.onExit(({ exitCode }) => {
      if (session.terminal !== terminal) return;
      session.terminalDead = true; session.terminal = null;
      this.emit({ type: 'diagnostic', message: `Native terminal for ${session.id} exited (${exitCode})` });
      if (session.owner === 'terminal') { session.owner = 'unknown'; this.phase(session, 'error', '原生终端已退出；后台任务状态未确认，请重新连接。'); }
    });
  }

  terminalInput(id, data) {
    const session = this.get(id);
    if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error('Invalid terminal input');
    if (!session.terminal || session.terminalDead) throw new Error('原生终端未运行。');
    if (!terminalReply(data) && (session.claiming || session.owner === 'gui' || (busy(session.phase) && session.owner !== 'terminal' && session.owner !== 'unknown'))) throw new Error('图形界面的任务进行中，原生终端暂时只读。');
    // Enter can dismiss a menu, insert a newline, or do nothing. Only the
    // engine's queue/activity notifications establish that a turn started.
    if (!terminalReply(data)) session.terminalTouched = true;
    session.terminal.write(data);
  }

  terminalResize(id, cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 250) throw new Error('Invalid terminal dimensions');
    this.get(id).terminal?.resize(cols, rows);
  }
  terminalSnapshot(id) {
    const session = this.get(id);
    return { data: session.terminalData, sequence: session.terminalSequence, truncated: session.terminalTruncated };
  }
  async stopTerminal(session) {
    const terminal = session.terminal; session.terminal = null;
    if (!terminal || session.terminalDead) return;
    session.terminalDead = true;
    try { terminal.kill(); } catch {}
  }

  onNotification(method, params) {
    if (['_x.ai/sessions/changed', 'x.ai/sessions/changed'].includes(method)) {
      for (const entry of params?.upserted || []) {
        const session = this.engineSessions.get(entry.sessionId);
        if (session) this.applyActivity(session, entry.activity);
      }
      return;
    }
    const session = this.engineSessions.get(params?.sessionId);
    if (!session) {
      if (typeof params?.sessionId === 'string' && params?.update?.sessionUpdate === 'available_commands_update') {
        if (this.pendingCommands.size > 100) this.pendingCommands.clear();
        this.pendingCommands.set(params.sessionId, commandCatalog(params.update.availableCommands));
      }
      return;
    }
    if (['_x.ai/queue/changed', 'x.ai/queue/changed'].includes(method)) {
      if (session.owner !== 'gui' && !session.replay && Array.isArray(params.entries)) {
        session.queuedPrompts = params.entries.length;
        if (typeof params.runningPromptId === 'string' || params.entries.length) this.applyActivity(session, 'working');
        else this.applyActivity(session, 'idle');
      }
      return;
    }
    if (['session/update', '_x.ai/session/update', '_x.ai/session_notification'].includes(method)) {
      const update = params?.update;
      if (!update || typeof update.sessionUpdate !== 'string') return;
      if (session.emptyHistoryVerification) {
        const emptyBackgroundTasks = update.sessionUpdate === 'background_tasks' && Array.isArray(update.tasks) && update.tasks.length === 0
          && Object.keys(update).every(key => key === 'sessionUpdate' || key === 'tasks');
        if (['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan', 'turn_completed'].includes(update.sessionUpdate)) session.emptyHistoryVerification.hasContent = true;
        else if (!emptyBackgroundTasks && !['available_commands_update', 'config_option_update', 'current_mode_update', 'session_info_update', 'model_changed', 'usage_update'].includes(update.sessionUpdate)) session.emptyHistoryVerification.uncertain = true;
      }
      const replay = session.replay === true || params?._meta?.isReplay === true || update?._meta?.isReplay === true;
      this.emit({ type: 'update', conversationId: session.id, replay, update });
      if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        session.commands = commandCatalog(update.availableCommands); this.publishSession(session);
      }
      if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
        Object.assign(session, sessionCatalog(update, session)); this.publishSession(session);
      }
      if (update.sessionUpdate === 'model_changed' && typeof update.model_id === 'string') {
        session.currentModelId = update.model_id;
        if (typeof update.reasoning_effort === 'string') session.currentEffort = update.reasoning_effort;
        this.publishSession(session);
      }
      if (!replay && session.owner !== 'gui') {
        if (['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'user_message_chunk'].includes(update.sessionUpdate)) {
          session.owner = 'terminal'; this.phase(session, 'running');
        }
        // Verified upstream notification.rs wire shape; never use response_completed (one model call) as turn completion.
        if (update.sessionUpdate === 'turn_completed' && typeof update.stop_reason === 'string') {
          if (!session.queuedPrompts) {
            session.owner = null; session.terminalTouched = false;
            this.phase(session, update.stop_reason === 'error' ? 'error' : 'ready', update.error_kind);
          }
        }
      }
      return;
    }
    if (['_x.ai/session/prompt_complete', 'x.ai/session/prompt_complete'].includes(method) && session.owner !== 'gui' && !session.replay && !session.queuedPrompts && typeof params.stopReason === 'string') {
      session.owner = null; session.terminalTouched = false;
      this.phase(session, params.stopReason === 'error' ? 'error' : 'ready', params.errorKind);
    }
  }

  onRequest(request) {
    const { method, params, respond } = request;
    if (method !== 'session/request_permission') { respond(null, { code: -32601, message: 'Client method not supported' }); return; }
    const session = this.engineSessions.get(params?.sessionId);
    const options = Array.isArray(params?.options) ? params.options.filter(option => typeof option?.optionId === 'string').map(option => ({ optionId: option.optionId, name: option.name || option.optionId, kind: option.kind || '' })) : [];
    if (!session || session.owner !== 'gui' || session.phase === 'cancelling' || !options.length) { respond({ outcome: { outcome: 'cancelled' } }); return; }
    const requestId = randomUUID();
    const permission = { requestId, conversationId: session.id, engineSessionId: session.engineSessionId,
      title: params.toolCall?.title || 'Grok 请求执行工具', detail: redact(JSON.stringify(params.toolCall?.rawInput ?? params.toolCall ?? {}, null, 2)), options };
    this.permissions.set(requestId, { permission, respond, session, generation: this.generation });
    this.phase(session, 'waiting'); this.emit({ type: 'permission', permission });
  }

  respondPermission(requestId, optionId) {
    const pending = this.permissions.get(requestId);
    if (!pending) throw new Error('该权限请求已结束或已取消。');
    if (optionId !== null && !pending.permission.options.some(option => option.optionId === optionId)) throw new Error('此选项不是引擎提供的审批范围。');
    this.permissions.delete(requestId);
    const valid = pending.generation === this.generation && pending.session.owner === 'gui' && pending.session.phase !== 'cancelling';
    pending.respond(valid && optionId !== null ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
    if (pending.session.phase === 'waiting') this.phase(pending.session, 'running');
  }
  cancelPermissions(id) {
    for (const [key, pending] of this.permissions) {
      if (id && pending.session.id !== id) continue;
      this.permissions.delete(key);
      try { pending.respond({ outcome: { outcome: 'cancelled' } }); } catch {}
    }
  }

  async dispose(invalidateStart = true) {
    if (invalidateStart) this.startEpoch++;
    this.disposing = true; this.generation++;
    const leader = this.leader; this.leader = null;
    const socket = this.socket, socketDirectory = this.socketDirectory;
    this.socket = null; this.socketDirectory = null;
    this.cancelPermissions();
    const terminals = [];
    for (const session of this.sessions.values()) {
      if (session.owner) { try { this.client.notify('session/cancel', { sessionId: session.engineSessionId }); } catch {} }
      terminals.push(this.stopTerminal(session));
    }
    this.sessions.clear(); this.engineSessions.clear(); this.opening.clear();
    this.pendingCommands.clear();
    const clientStop = this.client.stop();
    const previousCleanup = this.cleanupPromise;
    const cleanup = (async () => {
      await Promise.allSettled([...terminals, clientStop, previousCleanup]);
      await stopOwnedProcess(leader);
      if (socketDirectory) {
        if (socket) await unlink(socket).catch(() => {});
        await rmdir(socketDirectory).catch(() => {});
      }
    })();
    this.cleanupPromise = cleanup;
    await cleanup;
    if (this.cleanupPromise === cleanup) this.cleanupPromise = null;
  }
}
