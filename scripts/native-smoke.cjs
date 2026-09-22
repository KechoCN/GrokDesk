// Executed by the packaged Electron with ELECTRON_RUN_AS_NODE=1.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const [archivePath, expectedArch] = process.argv.slice(2);
assert.ok(process.versions.electron, 'Smoke test must use the packaged Electron runtime.');
assert.equal(process.arch, expectedArch);
assert.ok(path.isAbsolute(archivePath) && path.basename(archivePath) === 'app.asar', 'Pass the packaged app.asar, not its unpacked dependency directory.');
// Match the app's module resolution. Loading node-pty directly from app.asar.unpacked
// triggers its Unix helper-path rewrite twice (microsoft/node-pty#923).
const appRequire = createRequire(path.join(archivePath, 'package.json'));
assert.ok(appRequire.resolve('node-pty').startsWith(`${archivePath}${path.sep}`), 'node-pty must resolve through the packaged ASAR.');
const pty = appRequire('node-pty');
const shell = process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/sh';
const suffix = `PTY_${Date.now()}`;
const token = `GROKDESK_${suffix}`;
const args = process.platform === 'win32' ? ['/d', '/q'] : [];
const child = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
let output = '';
const timeout = setTimeout(() => { child.kill(); console.error('Packaged node-pty timed out:', output); process.exit(1); }, 15_000);
child.onData(data => { output += data; });
child.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  try {
    assert.equal(exitCode, 0);
    assert.ok(output.includes(token), `No PTY output received: ${output}`);
    console.log(JSON.stringify({ nativeSmoke: 'passed', platform: process.platform, arch: process.arch, electron: process.versions.electron }));
    process.exit(0);
  } catch (error) { console.error(error); process.exit(1); }
});
child.resize(100, 30);
// The complete marker never appears in typed input, even if the terminal echoes it.
child.write(process.platform === 'win32' ? `@echo off\r\nset "grokdeskSmoke=${suffix}"\r\necho GROKDESK_%grokdeskSmoke%\r\nexit /b 0\r\n`
  : `printf '%s%s\\n' 'GROKDESK_' '${suffix}'\nexit 0\n`);
