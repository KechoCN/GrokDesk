import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseInspection, scanFiles, contextCatalog } from '../electron/context-catalog.mjs';

test('discovery only exposes public invocable skill/plugin metadata', () => {
  const parsed = parseInspection({
    skills: [{ name: 'compose', description: 'Compose music', source: { path: '/skills/compose/SKILL.md' }, userInvocable: true },
      { name: 'hidden', userInvocable: false }, { name: 'compose', source: { path: '/fallback/SKILL.md' } }],
    plugins: [{ name: 'music', description: 'Notation', env: { API_KEY: 'must-not-leak' } }, { name: 'off', enabled: false }],
    configSources: [{ token: 'must-not-leak' }], mcpServers: [{ env: { SECRET: 'must-not-leak' } }],
  });
  assert.deepEqual(parsed.map(item => item.id), ['skill:compose', 'plugin:music']);
  assert.equal(parsed[0].path, '/skills/compose/SKILL.md');
  assert.equal(parsed[0].insertText, '/compose ');
  assert.match(parsed[1].insertText, /Use the installed "music" plugin/);
  assert.doesNotMatch(JSON.stringify(parsed), /must-not-leak|API_KEY|SECRET|configSources/);
});

test('file context respects gitignore and never escapes the chosen project', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'grokdesk-context-'));
  const project = path.join(temp, 'project');
  try {
    await fs.mkdir(project);
    execFileSync('git', ['init', '--quiet', project], { windowsHide: true });
    await fs.writeFile(path.join(project, '.gitignore'), 'ignored/\n');
    await fs.mkdir(path.join(project, 'ignored'));
    await fs.writeFile(path.join(project, 'ignored', 'hidden.ts'), '');
    await fs.mkdir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src', 'hello world.ts'), 'export const value = 1;');
    await fs.writeFile(path.join(project, '.env'), 'PRIVATE=never-display');
    await fs.writeFile(path.join(project, '.env.example'), 'EXAMPLE=');
    await fs.writeFile(path.join(project, 'auth.json'), '{}');
    await fs.writeFile(path.join(temp, 'outside.txt'), 'outside');
    try { await fs.symlink(temp, path.join(project, 'outside'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* Symlink permission is not guaranteed on Windows. */ }
    const result = await scanFiles(project);
    const names = result.items.map(item => item.name);
    assert.ok(names.includes('src/hello world.ts'));
    assert.ok(names.includes('.env.example'));
    assert.ok(!names.includes('.env'));
    assert.ok(!names.includes('auth.json'));
    assert.ok(!names.some(name => name.includes('ignored') || name.includes('outside')));
    assert.equal(result.truncated, false);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('missing engine still offers local files with an explicit discovery warning', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'grokdesk-context-'));
  try {
    await fs.writeFile(path.join(temp, 'score.md'), '# Score');
    const result = await contextCatalog({ cwd: temp }, 'mention', 'score');
    assert.deepEqual(result.items.map(item => item.name), ['score.md']);
    assert.ok(result.warning);
    await assert.rejects(contextCatalog({ cwd: temp }, 'bad', ''), /Invalid context query/);
    await assert.rejects(contextCatalog({ cwd: temp }, 'mention', 'x'.repeat(201)), /Invalid context query/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
