import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
const { DebugLogger } = require('builder-util');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[''].version);
const extension = JSON.parse(readFileSync(path.join(root, 'electron/browser-extension/manifest.json'), 'utf8'));
assert.equal(extension.version, pkg.version, 'Browser extension and desktop release versions must match.');
const config = await getConfig(root, path.join(root, 'electron-builder.yml'));
await validateConfiguration(config, new DebugLogger(false));
assert.equal(config.electronVersion, pkg.devDependencies.electron);
for (const platform of ['win', 'mac', 'linux']) {
  assert.ok(config[platform].target.length >= 2);
  for (const target of config[platform].target) assert.deepEqual(target.arch, ['x64', 'arm64']);
}
for (const file of ['Assets/GrokDesk.ico', 'Assets/GrokDesk.icns', 'Assets/grok-mobile.png', 'build/before-pack.cjs', 'build/after-pack.cjs']) {
  assert.ok(existsSync(path.join(root, file)), `Missing build resource: ${file}`);
}
if (process.env.GITHUB_REF?.startsWith('refs/tags/')) {
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${pkg.version}`, 'Release tag must exactly match package.json.');
}
console.log(`Release configuration valid: GrokDesk ${pkg.version}, three platforms × two architectures.`);
