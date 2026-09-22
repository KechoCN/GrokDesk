import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../renderer/composer-completion.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { completionToken, replaceCompletion, isCompositionKey } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('slash and mention completion follows the cursor and ignores ordinary email/URLs', () => {
  assert.deepEqual(completionToken('/', 1), { kind: 'command', query: '', start: 0, end: 1 });
  assert.deepEqual(completionToken('Read @src/Composer.tsx next', 9), { kind: 'mention', query: 'src', start: 5, end: 22 });
  assert.equal(completionToken('user@example.com', 16), null);
  assert.equal(completionToken('https://grok.com', 16), null);
  assert.equal(completionToken('/usr/bin', 8), null);
  assert.deepEqual(completionToken('请使用 /music', 10), { kind: 'command', query: 'music', start: 4, end: 10 });
});

test('completion replaces the full token while preserving surrounding text', () => {
  const value = 'Read @src/file.ts and explain';
  const token = completionToken(value, 9);
  const result = replaceCompletion(value, token, '@"src/hello world.ts" ');
  assert.equal(result.value, 'Read @"src/hello world.ts"  and explain');
  assert.equal(result.caret, 27);
});

test('IME confirmation never selects a menu entry or submits a message', () => {
  assert.equal(isCompositionKey({ isComposing: true }, false, 0, 1000), true);
  assert.equal(isCompositionKey({ keyCode: 229 }, false, 0, 1000), true);
  assert.equal(isCompositionKey({}, true, 0, 1000), true);
  assert.equal(isCompositionKey({}, false, 990, 1000), true);
  assert.equal(isCompositionKey({}, false, 500, 1000), false);
});
