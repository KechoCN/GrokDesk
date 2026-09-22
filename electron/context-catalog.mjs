import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { desktopEnvironment } from './platform.mjs';

const catalogCache = new Map();
const fileCache = new Map();
const MAX_RESULTS = 60;
const MAX_INSPECT_BYTES = 4 * 1024 * 1024;
const excludedDirectories = new Set(['.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'renderer-dist', 'build', 'coverage', '.next', '.cache', '.venv', 'venv', '__pycache__']);
const sensitiveName = name => /^(?:\.env(?:\..+)?|auth\.json|credentials(?:\..+)?|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|.*\.(?:pem|p12|pfx|key))$/i.test(name) && !/^\.env\.(?:example|sample|template)$/i.test(name);
const text = (value, max = 1000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '';
const within = (root, candidate) => { const relative = path.relative(root, candidate); return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };

// Use Grok's own discovery so custom paths, priorities, ignored/disabled skills,
// bundled skills and compatible plugin installations match the native TUI.
// Deliberately retain only public catalog metadata, never config, MCP env or auth.
export function parseInspection(value) {
  const entries = [];
  const seen = new Set();
  for (const skill of Array.isArray(value?.skills) ? value.skills.slice(0, 2000) : []) {
    const name = text(skill?.name, 200);
    const source = text(skill?.source?.path, 4096);
    if (!name || skill.userInvocable === false || seen.has('skill:' + name)) continue;
    seen.add('skill:' + name);
    entries.push({ id: 'skill:' + name, kind: 'skill', name, description: text(skill.description),
      ...(source && path.basename(source).toLowerCase() === 'skill.md' ? { path: source } : {}), insertText: '/' + name + ' ' });
  }
  for (const plugin of Array.isArray(value?.plugins) ? value.plugins.slice(0, 1000) : []) {
    const name = text(plugin?.name ?? plugin?.id, 200);
    if (!name || plugin.enabled === false || plugin.disabled === true || seen.has('plugin:' + name)) continue;
    seen.add('plugin:' + name);
    entries.push({ id: 'plugin:' + name, kind: 'plugin', name, description: text(plugin.description),
      // This is an ordinary prompt request for the engine's discovered plugin,
      // not an invented ACP or native slash command.
      insertText: `Use the installed ${JSON.stringify(name)} plugin for this task. ` });
  }
  return entries;
}

function inspectEngine({ executable, cwd, environment }) {
  if (!executable) return Promise.reject(new Error('Engine unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['inspect', '--json'], { cwd, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0, finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Discovery timed out')); }, 12000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_INSPECT_BYTES) { child.kill(); finish(new Error('Discovery exceeded limit')); }
      else chunks.push(chunk);
    });
    child.once('error', () => finish(new Error('Discovery unavailable')));
    child.once('close', code => {
      if (code !== 0) return finish(new Error('Discovery failed'));
      try { finish(null, parseInspection(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch { finish(new Error('Invalid discovery response')); }
    });
  });
}

async function discovered(context) {
  const key = `${context.executable}\0${context.cwd}`;
  const cached = catalogCache.get(key);
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  const value = inspectEngine(context).catch(error => { catalogCache.delete(key); throw error; });
  catalogCache.set(key, { at: Date.now(), value });
  if (catalogCache.size > 20) catalogCache.delete(catalogCache.keys().next().value);
  return value;
}

async function gitFileNames(cwd) {
  return new Promise(resolve => {
    const child = spawn('git', ['-C', cwd, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { env: desktopEnvironment(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '', bytes = 0, finished = false;
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(null); }, 1800);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) { child.kill(); finish(null); } else output += chunk; });
    child.once('error', () => finish(null));
    child.once('close', code => finish(code === 0 ? output.split('\0').filter(Boolean) : null));
  });
}

function eligible(relative) {
  const parts = relative.split(/[\\/]/);
  return parts.every(part => !excludedDirectories.has(part.toLowerCase())) && !sensitiveName(parts.at(-1));
}

export async function scanFiles(cwd) {
  const root = await fs.realpath(cwd);
  const names = await gitFileNames(root);
  const entries = [], seen = new Set(), checkedParents = new Map([[root, true]]);
  let truncated = false, inspected = 0, visitedEntries = 0;
  const deadline = Date.now() + 1800;
  const add = async relative => {
    if (!eligible(relative) || seen.has(relative)) return;
    seen.add(relative);
    const absolute = path.resolve(root, relative);
    if (!within(root, absolute)) return;
    try {
      // Git can enumerate through a Windows junction; reject every symbolic
      // ancestor even when a junction loops back into the project later.
      let parent = path.dirname(absolute);
      const parents = [];
      while (!checkedParents.has(parent)) { parents.push(parent); parent = path.dirname(parent); }
      let safe = checkedParents.get(parent);
      for (const directory of parents.reverse()) {
        if (safe) { const metadata = await fs.lstat(directory); safe = metadata.isDirectory() && !metadata.isSymbolicLink(); }
        checkedParents.set(directory, safe);
      }
      if (!safe) return;
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) return;
      if (!within(root, await fs.realpath(absolute))) return;
      entries.push({ id: 'file:' + relative, kind: 'file', name: relative.replaceAll('\\', '/'), description: '', path: absolute });
    } catch { /* A file may disappear while the menu is open. */ }
  };
  if (names) {
    for (const name of names) {
      if (++inspected > 5000 || Date.now() > deadline) { truncated = true; break; }
      await add(name);
    }
  } else {
    const queue = [{ directory: root, depth: 0 }];
    while (queue.length) {
      if (++inspected > 600 || Date.now() > deadline || entries.length >= 3000) { truncated = true; break; }
      const { directory, depth } = queue.shift();
      try {
        // Stream directory entries instead of allocating an arbitrarily large
        // readdir result for non-Git workspaces.
        const children = await fs.opendir(directory);
        for await (const child of children) {
          if (++visitedEntries > 15000 || Date.now() > deadline || entries.length >= 3000) { truncated = true; break; }
          if (child.isSymbolicLink()) continue;
          const absolute = path.join(directory, child.name);
          const relative = path.relative(root, absolute);
          if (!eligible(relative)) continue;
          if (child.isDirectory()) { if (depth < 8 && queue.length < 600) queue.push({ directory: absolute, depth: depth + 1 }); else truncated = true; }
          else if (child.isFile()) await add(relative);
        }
      } catch { continue; }
      if (visitedEntries > 15000) break;
    }
  }
  return { items: entries, truncated };
}

async function projectFiles(cwd) {
  const cached = fileCache.get(cwd);
  if (cached && Date.now() - cached.at < 10000) return cached.value;
  const value = scanFiles(cwd).catch(error => { fileCache.delete(cwd); throw error; });
  fileCache.set(cwd, { at: Date.now(), value });
  if (fileCache.size > 20) fileCache.delete(fileCache.keys().next().value);
  return value;
}

export async function contextCatalog(context, kind, query = '') {
  if (!['command', 'mention'].includes(kind) || typeof query !== 'string' || query.length > 200) throw new Error('Invalid context query');
  const [catalog, files] = await Promise.allSettled([discovered(context), kind === 'mention' ? projectFiles(context.cwd) : Promise.resolve({ items: [], truncated: false })]);
  const entries = [...(catalog.status === 'fulfilled' ? catalog.value : []), ...(files.status === 'fulfilled' ? files.value.items : [])];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = entries.filter(item => !needle || `${item.name} ${item.description}`.toLocaleLowerCase().includes(needle));
  filtered.sort((a, b) => Number(b.name.toLocaleLowerCase().startsWith(needle)) - Number(a.name.toLocaleLowerCase().startsWith(needle)) || a.name.localeCompare(b.name));
  return { items: filtered.slice(0, MAX_RESULTS), truncated: filtered.length > MAX_RESULTS || (files.status === 'fulfilled' && files.value.truncated),
    ...(catalog.status === 'rejected' ? { warning: '无法读取 Grok 扩展目录。请检查引擎连接后重试。' } : files.status === 'rejected' ? { warning: '无法读取项目文件。' } : {}) };
}
