import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const hostPlatform = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
const options = { platform: hostPlatform, arch: process.arch, dir: false, skipTests: false, requireNative: false };
for (let i = 2; i < process.argv.length; i++) {
  const value = process.argv[i];
  if (value === '--platform' || value === '--arch') options[value.slice(2)] = process.argv[++i];
  else if (value === '--dir') options.dir = true;
  else if (value === '--skip-tests') options.skipTests = true;
  else if (value === '--require-native') options.requireNative = true;
  else if (value === '--help') {
    console.log('node scripts/package.mjs [--platform win|mac|linux] [--arch x64|arm64] [--dir] [--skip-tests] [--require-native]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${value}`);
}
if (!['win', 'mac', 'linux'].includes(options.platform) || !['x64', 'arm64'].includes(options.arch)) throw new Error('Supported platforms: win, mac, linux; architectures: x64, arm64.');
if (options.platform !== hostPlatform) throw new Error(`Build ${options.platform} on its own OS. The GitHub Actions matrix provides native runners for all targets.`);
const nativeHost = options.arch === process.arch;
if ((!nativeHost && options.platform === 'linux') || (options.requireNative && !nativeHost)) throw new Error('This build requires a native runner with the target architecture.');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');

function checkedPath(candidate) {
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing filesystem operation outside the project: ${absolute}`);
  let current = absolute;
  while (current !== path.resolve(root)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refusing build path through a symbolic link or junction: ${current}`);
    current = path.dirname(current);
  }
  return absolute;
}
function remove(candidate) { rmSync(checkedPath(candidate), { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
async function move(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(checkedPath(source), checkedPath(destination)); return; }
    catch (error) {
      // Windows may briefly retain executable handles after the PTY smoke process exits.
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
      await delay(125 * 2 ** attempt);
    }
  }
}
function run(args, extra = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args[0]} failed (exit ${result.status}).`);
}
function requireFile(candidate) {
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error(`Packaged file is missing: ${candidate}`);
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const repositoryUrl = process.env.GROKDESK_REPOSITORY_URL || (process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}` : pkg.homepage);
if (repositoryUrl && !/^https:\/\/[^\s]+$/.test(repositoryUrl)) throw new Error('GROKDESK_REPOSITORY_URL must be an HTTPS project URL.');
if (options.platform === 'linux' && !options.dir && !repositoryUrl) {
  throw new Error('Linux .deb needs a project homepage. Set GROKDESK_REPOSITORY_URL to the real repository URL; GitHub Actions supplies it automatically.');
}
const macIdentity = process.env.GROKDESK_MAC_SIGN_IDENTITY;
const notarize = process.env.GROKDESK_MAC_NOTARIZE === '1';
if (notarize && !macIdentity) throw new Error('GROKDESK_MAC_NOTARIZE=1 requires GROKDESK_MAC_SIGN_IDENTITY and Apple notarization credentials.');
if (macIdentity === '-') throw new Error('Omit GROKDESK_MAC_SIGN_IDENTITY for ad-hoc builds; this override requires a real signing identity.');
const apple = process.env;
if (notarize && !((apple.APPLE_API_KEY && apple.APPLE_API_KEY_ID && apple.APPLE_API_ISSUER)
  || (apple.APPLE_ID && apple.APPLE_APP_SPECIFIC_PASSWORD && apple.APPLE_TEAM_ID)
  || (apple.APPLE_KEYCHAIN && apple.APPLE_KEYCHAIN_PROFILE))) {
  throw new Error('Notarization requested without a complete Apple API key, Apple ID, or keychain credential set.');
}
const signWindows = process.env.GROKDESK_WIN_SIGN === '1';
const outputRoot = checkedPath(path.join(root, 'dist', pkg.version));
const target = `${options.platform}-${options.arch}`;
const destination = checkedPath(path.join(outputRoot, target));
const staging = checkedPath(path.join(outputRoot, `.staging-${target}-${randomUUID()}`));
const previous = checkedPath(path.join(outputRoot, `.previous-${target}-${randomUUID()}`));
const lockPath = checkedPath(path.join(root, '.package.lock'));
let lock;
let published = false;
try {
  try { lock = openSync(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another package job owns .package.lock. Run builds sequentially in a checkout; remove a stale lock only after confirming no package process is running.');
    throw error;
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, target, started: new Date().toISOString() }));
  run(['scripts/validate-release.mjs']);
  if (!options.skipTests) run(['scripts/run-tests.mjs']);
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
  run(['node_modules/vite/bin/vite.js', 'build']);
  if (!options.skipTests) run(['scripts/run-tests.mjs', '--smoke']);
  mkdirSync(staging, { recursive: true });
  const args = ['node_modules/electron-builder/cli.js', '--config', 'electron-builder.yml', `--${options.platform}`];
  // Explicit CLI target names override each config target's arch array. Without them,
  // electron-builder builds both configured architectures despite --x64/--arm64.
  args.push(...(options.dir ? ['dir'] : options.platform === 'win' ? ['nsis', 'portable'] : options.platform === 'mac' ? ['dmg', 'zip'] : ['AppImage', 'deb']));
  args.push(`--${options.arch}`, '--publish', 'never', `--config.directories.output=${staging}`);
  args.push(`--config.npmRebuild=${options.platform === 'linux'}`);
  if (repositoryUrl) args.push(`--config.extraMetadata.homepage=${repositoryUrl}`);
  if (options.platform === 'mac' && macIdentity) args.push(`--config.mac.identity=${macIdentity}`, '--config.mac.hardenedRuntime=true', '--config.forceCodeSigning=true');
  if (options.platform === 'mac') args.push(`--config.mac.notarize=${notarize}`);
  if (options.platform === 'win' && signWindows) args.push('--config.win.signExecutable=true', '--config.forceCodeSigning=true');
  const builderEnv = { ...process.env };
  delete builderEnv.ELECTRON_RUN_AS_NODE;
  if (options.platform === 'mac' && !macIdentity) {
    // PR builds may safely ad-hoc sign: explicitly prevent certificate discovery/import.
    // electron-builder otherwise skips even ad-hoc signing when GITHUB_BASE_REF exists.
    builderEnv.CSC_FOR_PULL_REQUEST = 'true';
    builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME']) delete builderEnv[key];
  }
  run(args, { env: builderEnv });

  const unpackedName = options.platform === 'win' ? (options.arch === 'x64' ? 'win-unpacked' : `win-${options.arch}-unpacked`)
    : options.platform === 'mac' ? (options.arch === 'x64' ? 'mac' : `mac-${options.arch}`)
      : (options.arch === 'x64' ? 'linux-unpacked' : `linux-${options.arch}-unpacked`);
  const unpacked = path.join(staging, unpackedName);
  const resources = options.platform === 'mac' ? path.join(unpacked, 'GrokDesk.app/Contents/Resources') : path.join(unpacked, 'resources');
  const executable = options.platform === 'mac' ? path.join(unpacked, 'GrokDesk.app/Contents/MacOS/GrokDesk')
    : path.join(unpacked, options.platform === 'win' ? 'GrokDesk.exe' : 'grokdesk');
  const archive = path.join(resources, 'app.asar');
  const nativeModule = path.join(resources, 'app.asar.unpacked/node_modules/node-pty');
  for (const file of [executable, archive, path.join(resources, 'Assets/GrokDesk.ico'), path.join(resources, 'Assets/grok-mobile.png'),
    path.join(resources, 'third-party/ZCode-LICENSE'), path.join(resources, 'third-party/ZCode-NOTICE.md'), path.join(nativeModule, 'lib/index.js')]) requireFile(file);
  const { extractFile, listPackage } = require('@electron/asar');
  const archivedPackage = JSON.parse(extractFile(archive, 'package.json').toString());
  if (archivedPackage.version !== pkg.version) throw new Error('Packaged version does not match package.json.');
  const archiveFiles = new Set(listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, '')));
  for (const file of ['electron/main.mjs', 'electron/preload.cjs', 'renderer-dist/index.html', 'electron/browser-extension/manifest.json']) {
    if (!archiveFiles.has(file)) throw new Error(`Required ASAR entry missing: ${file}`);
  }
  if (archiveFiles.has('electron/browser-extension/config.js')) throw new Error('A per-install browser connection key must never be packaged.');
  if (options.platform === 'linux') {
    // node-pty builds spawn-helper only on macOS; Linux starts PTYs with forkpty.
    requireFile(path.join(nativeModule, 'build/Release/pty.node'));
  } else {
    const nodePlatform = options.platform === 'win' ? 'win32' : 'darwin';
    const prebuild = path.join(nativeModule, 'prebuilds', `${nodePlatform}-${options.arch}`);
    for (const file of options.platform === 'win' ? ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'] : ['pty.node', 'spawn-helper']) requireFile(path.join(prebuild, file));
  }
  if (options.platform === 'mac') {
    const appBundle = path.join(unpacked, 'GrokDesk.app');
    const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'inherit', timeout: 60_000 });
    if (signature.error) throw signature.error;
    if (signature.status !== 0) throw new Error('The packaged macOS app failed code signature verification.');
    const details = spawnSync('codesign', ['--display', '--verbose=4', appBundle], { encoding: 'utf8', timeout: 15_000 });
    if (details.error) throw details.error;
    const signingInfo = `${details.stdout}\n${details.stderr}`;
    if (details.status !== 0 || !(macIdentity ? /^Authority=Developer ID Application:/m : /^Signature=adhoc$/m).test(signingInfo)) {
      throw new Error(`The packaged macOS app does not have the requested ${macIdentity ? 'Developer ID' : 'ad-hoc'} signature.`);
    }
  }
  if (options.platform === 'mac' && notarize) {
    const validation = spawnSync('xcrun', ['stapler', 'validate', path.join(unpacked, 'GrokDesk.app')], {
      cwd: root, stdio: 'inherit', timeout: 120_000,
    });
    if (validation.error) throw validation.error;
    if (validation.status !== 0) throw new Error('The packaged macOS app has no valid stapled notarization ticket.');
  }
  if (nativeHost) {
    const smoke = spawnSync(executable, [path.join(root, 'scripts/native-smoke.cjs'), archive, options.arch], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true, timeout: 25_000,
    });
    if (smoke.error) throw smoke.error;
    if (smoke.status !== 0) throw new Error(`Packaged node-pty smoke failed (exit ${smoke.status}).`);
  } else console.warn(`Cross-architecture ${target}: files checked, runtime test requires a native ${options.arch} machine.`);

  const artifacts = readdirSync(staging).filter(file => /\.(exe|dmg|zip|AppImage|deb)$/.test(file) && lstatSync(path.join(staging, file)).isFile()).sort();
  const expected = options.platform === 'win' ? ['-setup.exe', '-portable.exe'] : options.platform === 'mac' ? ['.dmg', '.zip'] : ['.AppImage', '.deb'];
  if (!options.dir && (artifacts.length !== 2 || expected.some(suffix => !artifacts.some(file => file.endsWith(suffix))))) throw new Error(`Incomplete release artifacts: ${artifacts.join(', ')}`);
  const checksumFiles = options.dir ? [path.relative(staging, executable).replaceAll('\\', '/')] : artifacts;
  const manifest = {
    product: 'GrokDesk', version: pkg.version, electron: pkg.devDependencies.electron, platform: options.platform, arch: options.arch,
    builtAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, directoryOnly: options.dir,
    signing: options.platform === 'mac' ? (macIdentity ? `Developer ID; ${notarize ? 'notarized' : 'not notarized'}` : 'ad-hoc; not notarized')
      : options.platform === 'win' && signWindows ? 'Authenticode' : 'unsigned',
    nativeRuntimeTest: nativeHost ? 'passed' : 'not-run-cross-architecture',
    artifacts: await Promise.all(checksumFiles.map(async file => ({ file, sha256: await sha256(path.join(staging, file)) }))),
  };
  const manifestName = `GrokDesk-${pkg.version}-${target}-build.json`;
  writeFileSync(path.join(staging, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  const hashes = [...manifest.artifacts, { file: manifestName, sha256: await sha256(path.join(staging, manifestName)) }];
  writeFileSync(path.join(staging, 'SHA256SUMS.txt'), hashes.map(entry => `${entry.sha256}  ${entry.file}\n`).join(''));
  if (existsSync(destination)) await move(destination, previous);
  try { await move(staging, destination); published = true; }
  catch (error) { if (existsSync(previous) && !existsSync(destination)) await move(previous, destination); throw error; }
  if (existsSync(previous)) remove(previous);
  console.log(`GrokDesk ${pkg.version} ${target}: ${destination}`);
} finally {
  if (lock !== undefined) { closeSync(lock); remove(lockPath); }
  if (!published && existsSync(staging)) console.error(`Failed build staging retained for diagnosis: ${staging}`);
}
