import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { grokHome } from './platform.mjs';

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const revisionOf = content => createHash('sha256').update(content).digest('hex');
export const engineConfigPath = (environment = process.env) => path.join(grokHome(environment), 'config.toml');

export async function readEngineConfig(environment = process.env) {
  const filename = engineConfigPath(environment);
  let content = '', exists = true;
  try {
    const handle = await open(filename, 'r');
    try {
      if ((await handle.stat()).size > MAX_CONFIG_BYTES) throw new Error('Grok 配置超过 2 MiB，请在外部编辑器中打开。');
      content = await handle.readFile('utf8');
    } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  return { path: filename, content, revision: revisionOf(content), exists };
}

export function validateEngineConfig(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new Error('配置内容必须是小于 2 MiB 的 TOML 文本。');
  try { parse(content); }
  catch (error) {
    // Parser messages include source snippets, which could contain a configured key.
    throw new Error(`TOML 语法错误${Number.isInteger(error.line) ? `，第 ${error.line} 行` : ''}${Number.isInteger(error.column) ? `，第 ${error.column} 列` : ''}；原配置未修改。`);
  }
}

let writeQueue = Promise.resolve();
export async function saveEngineConfig(content, revision, environment = process.env) {
  validateEngineConfig(content);
  const work = writeQueue.catch(() => {}).then(async () => {
    const current = await readEngineConfig(environment);
    if (revision !== current.revision) throw new Error('配置已被原版 TUI 或其他程序修改，请重新加载后再保存。');
    await mkdir(path.dirname(current.path), { recursive: true });
    const temporary = `${current.path}.grokdesk-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      if (current.exists) await writeFile(`${current.path}.grokdesk.bak`, current.content, { encoding: 'utf8', mode: 0o600 });
      const latest = await readEngineConfig(environment);
      if (latest.revision !== current.revision) throw new Error('配置在保存期间发生变化，请重新加载后重试。');
      await rename(temporary, current.path);
    } finally { await unlink(temporary).catch(() => {}); }
    return readEngineConfig(environment);
  });
  writeQueue = work;
  return work;
}

export async function ensureEngineConfig(environment = process.env) {
  const current = await readEngineConfig(environment);
  if (!current.exists) {
    await mkdir(path.dirname(current.path), { recursive: true });
    await writeFile(current.path, '# Grok Build user configuration\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  return current.path;
}
