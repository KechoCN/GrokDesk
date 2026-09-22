import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../renderer/platform.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { hasPrimaryModifier, terminalClipboardAction } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const key = overrides => ({ type: 'keydown', code: 'KeyC', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides });

test('desktop shortcuts use Command on macOS and Control on Windows/Linux', () => {
  for (const platform of ['win32', 'linux']) {
    assert.equal(hasPrimaryModifier(key({ ctrlKey: true }), platform), true);
    assert.equal(hasPrimaryModifier(key({ metaKey: true }), platform), false);
    assert.equal(hasPrimaryModifier(key({ ctrlKey: true, altKey: true }), platform), false);
  }
  assert.equal(hasPrimaryModifier(key({ metaKey: true }), 'darwin'), true);
  assert.equal(hasPrimaryModifier(key({ ctrlKey: true }), 'darwin'), false);
  assert.equal(hasPrimaryModifier(key({ ctrlKey: true, metaKey: true }), 'darwin'), false);
});

test('Control-C remains a terminal interrupt on every platform', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(terminalClipboardAction(key({ ctrlKey: true }), platform), undefined);
    assert.equal(terminalClipboardAction(key({ ctrlKey: true, code: 'KeyV' }), platform), undefined);
  }
});

test('terminal copy/paste handles native modifiers once and preserves other control sequences', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const modifiers = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true, shiftKey: true };
    assert.equal(terminalClipboardAction(key(modifiers), platform), 'copy');
    assert.equal(terminalClipboardAction(key({ ...modifiers, code: 'KeyV' }), platform), 'paste');
    assert.equal(terminalClipboardAction(key({ ...modifiers, type: 'keyup' }), platform), undefined);
    assert.equal(terminalClipboardAction(key({ ...modifiers, code: 'KeyA' }), platform), undefined);
    assert.equal(terminalClipboardAction(key({ ...modifiers, altKey: true }), platform), undefined);
  }
});
