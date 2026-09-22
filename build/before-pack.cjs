const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = async function beforePack({ packager, electronPlatformName: target, arch: architecture }) {
  const arch = Arch[architecture];
  if (target === 'linux') {
    if (process.platform !== 'linux' || process.arch !== arch) {
      throw new Error('Linux node-pty must be built on the matching native Linux architecture. Use the CI matrix.');
    }
    return;
  }
  const prebuild = path.join(packager.info.appDir, 'node_modules/node-pty/prebuilds', `${target}-${arch}`);
  const native = path.join(prebuild, target === 'win32' ? 'conpty.node' : 'pty.node');
  if (!fs.existsSync(native)) throw new Error(`Missing node-pty Node-API prebuild: ${native}`);
  if (target === 'darwin') fs.chmodSync(path.join(prebuild, 'spawn-helper'), 0o755);
};
