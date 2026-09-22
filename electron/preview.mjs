import fs from 'node:fs/promises';
import path from 'node:path';
import { inside } from './store.mjs';

const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const skipped = new Set(['node_modules', '.git', 'target', 'dist', 'renderer-dist', '.next', '.venv', 'vendor']);
const MAX_LIST = 300, MAX_VISITS = 2000, MAX_TEXT = 512 * 1024, MAX_IMAGE = 12 * 1024 * 1024;

export async function previewFiles(conversation) {
  const root = await fs.realpath(conversation.cwd);
  const attachments = [...(conversation.attachments || []), ...(conversation.attachmentHistory || []), ...(conversation.messages || []).flatMap(item => item.attachments || [])];
  const files = [...new Map(attachments.map(item => [item.path, { path: item.path, name: `附件 / ${item.name}`, size: item.size }])).values()];
  const queue = [{ directory: root, depth: 0 }];
  let visits = 0, truncated = false;
  while (queue.length && files.length < MAX_LIST && visits < MAX_VISITS) {
    const { directory, depth } = queue.shift();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visits > MAX_VISITS || files.length >= MAX_LIST) { truncated = true; break; }
      if (entry.isSymbolicLink() || skipped.has(entry.name)) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (depth < 4) queue.push({ directory: candidate, depth: depth + 1 }); else truncated = true; }
      else if (entry.isFile()) {
        try { const stat = await fs.stat(candidate); files.push({ path: candidate, name: path.relative(root, candidate), size: stat.size, modifiedAt: stat.mtime.toISOString() }); } catch { /* File disappeared while scanning. */ }
      }
    }
  }
  return { files, truncated: truncated || queue.length > 0 };
}

export async function readPreview(conversation, filename, dataDir) {
  if (typeof filename !== 'string' || filename.includes('\0') || !path.isAbsolute(filename)) throw new Error('预览路径无效');
  const file = await fs.realpath(filename);
  const roots = await Promise.all([conversation.cwd, path.join(dataDir, 'attachments', conversation.id)].map(directory => fs.realpath(directory).catch(() => null)));
  if (!roots.some(root => root && inside(root, file))) throw new Error('只能预览当前项目及本任务的附件');
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择文件进行预览');
    const record = { path: file, name: path.basename(filename), size: stat.size, kind: 'unsupported' };
    const mime = imageTypes[path.extname(file).toLowerCase()];
    if (mime && stat.size > MAX_IMAGE) return record;
    const limit = mime ? MAX_IMAGE : MAX_TEXT;
    const buffer = Buffer.alloc(Math.min(stat.size, limit) + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, Math.min(bytesRead, limit));
    if (mime) { if (bytesRead > limit) return record; return { ...record, kind: 'image', mime, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }; }
    if (bytes.includes(0)) return record;
    const truncated = stat.size > limit || bytesRead > limit;
    try { return { ...record, kind: 'text', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated }), truncated }; }
    catch { return record; }
  } finally { await handle.close(); }
}
