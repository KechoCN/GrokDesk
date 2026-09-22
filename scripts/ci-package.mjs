import { spawnSync } from 'node:child_process';
const args = ['scripts/package.mjs', '--platform', process.env.TARGET_PLATFORM, '--arch', process.env.TARGET_ARCH, '--skip-tests', '--require-native'];
if (process.env.DIRECTORY_ONLY === 'true') args.push('--dir');
const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
