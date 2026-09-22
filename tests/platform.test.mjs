import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationDataDirectory, appVersion, desktopEnvironment, findEngineExecutable, grokHome, initializeDesktopEnvironment, sameDirectory, terminalEnvironment } from '../electron/platform.mjs';
import { GrokAdapter } from '../electron/grok-adapter.mjs';
import { spawnOwnedProcess, stopOwnedProcess } from '../electron/acp-client.mjs';
import { clipboardFiles, parseFileUris, snapshotClipboard } from '../electron/clipboard-attachments.mjs';
import { DeskStore } from '../electron/store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'grokdesk-platform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('GUI launch recovers macOS tools and Linux user installations without replacing credentials', () => {
  const source = { HOME: '/home/user', USERPROFILE: 'C:\\wrong', PATH: '/custom/bin:/usr/bin', GROK_HOME: '/custom/grok', API_KEY: 'keep-inherited', SHELL: '/bin/zsh' };
  const linux = desktopEnvironment(source, { platform: 'linux' });
  assert.equal(linux.API_KEY, source.API_KEY);
  assert.equal(linux.SHELL, source.SHELL);
  assert.equal(linux.GROK_HOME, '/custom/grok');
  assert.ok(linux.PATH.startsWith('/custom/bin:/usr/bin:'));
  assert.ok(linux.PATH.includes('/home/user/.local/bin'));
  assert.equal(grokHome(source, 'linux'), '/custom/grok');
  const mac = desktopEnvironment({ HOME: '/Users/李', PATH: '/usr/bin:/bin' }, { platform: 'darwin' });
  assert.ok(mac.PATH.includes('/opt/homebrew/bin'));
  assert.ok(mac.PATH.includes('/usr/local/bin'));
  assert.equal(source.PATH, '/custom/bin:/usr/bin');
});

test('Windows PATH keys, quoted directories and case duplicates resolve to one child-process PATH', () => {
  const result = desktopEnvironment({ USERPROFILE: 'C:\\Users\\Lee', Path: '"C:\\Program Files\\Grok";C:\\TOOLS', PATH: 'c:\\tools;D:\\bin' }, { platform: 'win32' });
  assert.equal(result.Path, undefined);
  assert.deepEqual(result.PATH.split(';').slice(0, 3), ['C:\\Program Files\\Grok', 'C:\\TOOLS', 'D:\\bin']);
  assert.equal(findEngineExecutable(undefined, result, { platform: 'win32', executable: file => file === 'D:\\bin\\grok.exe' }), 'D:\\bin\\grok.exe');
});

test('engine discovery respects explicit choices and platform executable names', () => {
  const files = new Set(['/opt/homebrew/bin/grok', '/custom/grok']);
  const options = { platform: 'darwin', executable: filename => files.has(filename) };
  assert.equal(findEngineExecutable(undefined, { HOME: '/Users/example', PATH: '/usr/bin' }, options), '/opt/homebrew/bin/grok');
  assert.equal(findEngineExecutable('/custom/grok', {}, options), '/custom/grok');
  assert.equal(findEngineExecutable('/missing/grok', {}, options), null, 'An invalid user override must not select another engine');
});

test('Unix discovery rejects a file without execute permission', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t), file = path.join(directory, 'grok');
  await writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  assert.equal(findEngineExecutable(file), null);
  await chmod(file, 0o700);
  assert.equal(findEngineExecutable(file), file);
});

test('login shell PATH ignores banner output and leaves every other variable untouched', async () => {
  const environment = { HOME: '/Users/example', SHELL: '/bin/zsh', PATH: '/usr/bin', TOKEN: 'original' };
  const calls = [];
  await initializeDesktopEnvironment(environment, { platform: 'darwin', run: async (...args) => {
    calls.push(args); return { stdout: 'shell banner\n__GROKDESK_PATH__/custom/toolchain/bin:/usr/bin__GROKDESK_PATH__\n' };
  } });
  assert.ok(environment.PATH.startsWith('/custom/toolchain/bin:/usr/bin:'));
  assert.equal(environment.TOKEN, 'original');
  assert.equal(calls[0][0], '/bin/zsh');
  assert.equal(calls[0][2].timeout, 3000);
  const failed = { HOME: '/home/user', SHELL: '/bin/bash', PATH: '/usr/bin' };
  await initializeDesktopEnvironment(failed, { platform: 'linux', run: async () => { throw new Error('Shell startup timeout'); } });
  assert.ok(failed.PATH.includes('/home/user/.grok/bin'));
});

test('platform paths preserve POSIX case and use OS-specific application data locations', () => {
  assert.equal(sameDirectory('/work/Example', '/work/example', 'linux'), false);
  assert.equal(sameDirectory('/work/Example', '/work/example', 'darwin'), false);
  assert.equal(sameDirectory('C:\\Work\\Example', 'c:\\work\\example', 'win32'), true);
  assert.equal(applicationDataDirectory({ HOME: '/Users/lee' }, 'darwin'), '/Users/lee/Library/Application Support/GrokDesk');
  assert.equal(applicationDataDirectory({ HOME: '/home/lee', XDG_CONFIG_HOME: '/config' }, 'linux'), '/config/GrokDesk');
  assert.equal(applicationDataDirectory({ HOME: '/home/lee', XDG_CONFIG_HOME: 'relative' }, 'linux'), '/home/lee/.config/GrokDesk');
  assert.equal(applicationDataDirectory({ USERPROFILE: 'C:\\Users\\Lee', APPDATA: 'D:\\Profile' }, 'win32'), 'D:\\Profile\\GrokDesk');
  assert.deepEqual(terminalEnvironment({ SHELL: '/bin/fish', LANG: 'zh_CN.UTF-8' }), { SHELL: '/bin/fish', LANG: 'zh_CN.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor' });
});

test('case-sensitive project folders remain separate workspaces', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t), upper = path.join(directory, 'Project'), lower = path.join(directory, 'project');
  await mkdir(upper); await mkdir(lower, { recursive: true });
  if ((await stat(upper)).ino === (await stat(lower)).ino) return t.skip('The test volume is case insensitive');
  const store = new DeskStore(path.join(directory, 'data'), path.join(directory, 'documents'));
  const first = store.addWorkspace(upper), second = store.addWorkspace(lower);
  assert.notEqual(first.id, second.id);
  assert.equal(store.state.workspaces.length, 2);
});

test('ACP reports the package version and terminal inherits the selected engine directory', async t => {
  const directory = await fixture(t), calls = [], client = new EventEmitter();
  client.stop = async () => {};
  client.start = async (...args) => { calls.push({ start: args }); };
  client.request = async (method, params) => { calls.push({ method, params }); return { protocolVersion: 1, agentCapabilities: {} }; };
  const adapter = new GrokAdapter({ dependencies: { client, skipLeader: true, skipTerminal: true } });
  t.after(() => adapter.dispose());
  assert.equal((await adapter.start({ enginePath: process.execPath, cwd: directory })).state, 'ready');
  assert.equal(calls.find(call => call.method === 'initialize').params.clientInfo.version, appVersion);
  assert.equal(appVersion, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(calls[0].start[2].env.PATH.split(path.delimiter)[0], path.dirname(process.execPath));
  if (process.platform !== 'win32') assert.ok(Buffer.byteLength(adapter.socket) < 104, 'macOS socket path stays within sockaddr_un capacity');
});

test('owned POSIX process groups stop descendants that ignore SIGTERM', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const source = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000);`;
  const child = spawnOwnedProcess(spawn, process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => stopOwnedProcess(child));
  await once(child.stdout, 'data');
  const closed = once(child, 'close');
  await stopOwnedProcess(child);
  const [, signal] = await closed;
  assert.equal(signal, 'SIGKILL');
});

const item = payloads => ({ types: Object.keys(payloads), getType: async type => new Blob([payloads[type]], { type }) });

test('Electron async clipboard handles Finder/Explorer/Linux file URI lists with unicode and spaces', async () => {
  for (const platform of ['darwin', 'linux']) {
    const clipboard = { read: async () => [item({ 'text/uri-list': '# files\r\nfile:///home/%E6%9D%8E/first%20file.txt\r\nfile:///tmp/second.pdf\r\nhttps://example.com' })] };
    assert.deepEqual(await clipboardFiles(clipboard, { platform }), ['/home/李/first file.txt', '/tmp/second.pdf']);
  }
  assert.deepEqual(parseFileUris('file:///C:/Users/%E6%9D%8E/one%20file.txt', 'win32'), ['C:\\Users\\李\\one file.txt']);
  assert.deepEqual(await clipboardFiles({ read: async () => [item({ 'text/plain': '/home/private.txt' })] }, { platform: 'linux' }), []);
  assert.deepEqual(await clipboardFiles({ availableFormats: () => ['x-special/gnome-copied-files'], readBuffer: () => Buffer.from('copy\nfile:///tmp/file.txt') }, { platform: 'linux' }), ['/tmp/file.txt']);
});

test('async clipboard snapshots file references before previews and copies image bytes once', async t => {
  const directory = await fixture(t), file = path.join(directory, 'source.txt');
  await writeFile(file, 'copied from file manager');
  const conversation = { id: 'conversation', attachments: [] };
  let reads = 0;
  const files = await snapshotClipboard(directory, conversation, { read: async () => {
    reads++; return [item({ 'text/uri-list': pathToFileURL(file).href, 'image/png': 'preview' })];
  } });
  assert.equal(reads, 1);
  assert.equal(files.attachments[0].name, 'source.txt');
  assert.equal(await readFile(files.attachments[0].path, 'utf8'), 'copied from file manager');
  const bytes = Buffer.from([137, 80, 78, 71]);
  const image = await snapshotClipboard(directory, conversation, { read: async () => [item({ 'image/png': bytes })] });
  assert.deepEqual(await readFile(image.attachments[0].path), bytes);
  const text = await snapshotClipboard(directory, conversation, { read: async () => [item({ 'text/plain': 'ordinary paste' })] });
  assert.deepEqual(text, { attachments: [], handled: false });
});
