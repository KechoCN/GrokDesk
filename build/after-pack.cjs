// Fail before installer compression if production dependencies were silently omitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listPackage } = require('@electron/asar');

module.exports = async function afterPack({ appOutDir, electronPlatformName, packager }) {
  const resources = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app/Contents/Resources`)
    : path.join(appOutDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  const entries = new Set(listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, '')));
  assert.ok(entries.has('renderer-dist/THIRD-PARTY-LICENSES.md'), 'Bundled renderer dependency licenses must be included in app.asar.');
  for (const name of Object.keys(packager.info.metadata.dependencies || {})) {
    assert.ok(entries.has(`node_modules/${name}/package.json`), `Production dependency omitted from app.asar: ${name}`);
  }
  assert.ok(fs.existsSync(path.join(resources, 'app.asar.unpacked/node_modules/node-pty/lib/index.js')), 'node-pty must be unpacked with its workers and native binaries.');
};
