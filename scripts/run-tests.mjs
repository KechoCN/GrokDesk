import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = process.argv.includes('--smoke');
const files = smoke ? ['main-smoke.cjs', 'renderer-smoke.cjs', 'renderer-platform-smoke.cjs']
  : readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.mjs')).sort();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const testFlags = process.env.GROKDESK_TEST_NO_SANDBOX === '1' && process.platform === 'linux' ? ['--no-sandbox'] : [];
const batches = smoke ? files.map(file => [path.join(root, 'node_modules/electron/cli.js'), ...testFlags, path.join(root, 'tests', file)])
  : [['--test', ...files.map(file => path.join(root, 'tests', file))]];
for (const args of batches) {
  const child = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180_000 });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status || 1);
}
