import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { previewFiles, readPreview } from '../electron/preview.mjs';

test('preview lists bounded project files and reads text without executing HTML', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grokdesk-preview-'));
  try {
    const project = path.join(dir, 'project'); await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'test.html'), '<script>doNotExecute()</script>');
    await fs.writeFile(path.join(dir, 'outside.txt'), 'outside');
    await fs.writeFile(path.join(project, 'binary.bin'), Buffer.from([1, 0, 2]));
    const conversation = { id: 'task', cwd: project };
    assert.equal((await previewFiles(conversation)).files.length, 2);
    assert.equal((await readPreview(conversation, path.join(project, 'test.html'), dir)).content, '<script>doNotExecute()</script>');
    assert.equal((await readPreview(conversation, path.join(project, 'binary.bin'), dir)).kind, 'unsupported');
    await assert.rejects(readPreview(conversation, path.join(dir, 'outside.txt'), dir), /只能预览/);
    await assert.rejects(readPreview(conversation, '../outside.txt', dir), /路径无效/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
