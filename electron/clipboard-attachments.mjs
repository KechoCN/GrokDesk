import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MAX_FILE_BYTES, snapshotFiles, snapshotData } from './attachments.mjs';

const execFileAsync = promisify(execFile);
const fileFormats = /^(?:CF_HDROP|FileNameW?|Shell IDList Array|Preferred DropEffect|text\/uri-list)$/i;

/** Decode the standard DROPFILES structure; never interpret arbitrary clipboard text as paths. */
export function parseFileDrop(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return [];
  const offset = buffer.readUInt32LE(0), wide = buffer.readUInt32LE(16) !== 0;
  if (offset < 20 || offset >= buffer.length || (wide && (buffer.length - offset) % 2)) return [];
  return buffer.subarray(offset).toString(wide ? 'utf16le' : 'latin1').split('\0').filter(Boolean);
}

export function parseFileUris(value, platform = process.platform) {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).flatMap(line => {
    try { return line.startsWith('file:') ? [fileURLToPath(line, { windows: platform === 'win32' })] : []; } catch { return []; }
  }))];
}

const modernClipboard = clipboard => typeof clipboard.read === 'function' && typeof clipboard.availableFormats !== 'function';
const uriFormats = ['text/uri-list', 'x-special/gnome-copied-files', 'public.file-url'];
const rawFormat = format => `electron application/osclipboard;format="${format}"`;

async function itemFiles(items, platform) {
  const files = [];
  for (const item of items) {
    for (const format of uriFormats.flatMap(format => [format, rawFormat(format)])) {
      if (!item.types.includes(format)) continue;
      const blob = await item.getType(format);
      if (blob.size > 128 * 1024) throw new Error('剪贴板文件列表过大，请分批添加。');
      files.push(...parseFileUris(await blob.text(), platform));
    }
  }
  return [...new Set(files)];
}

async function windowsFiles() {
  // Windows Explorer publishes multiple files in CF_HDROP. Electron does not
  // consistently enumerate that standard format; use the native clipboard API.
  // The command is fixed, contains no user data and launches without a window.
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $clipboardFiles = @([System.Windows.Forms.Clipboard]::GetFileDropList()); ConvertTo-Json -InputObject $clipboardFiles -Compress'],
  { windowsHide: true, timeout: 7000, maxBuffer: 128 * 1024, encoding: 'utf8' });
  const paths = JSON.parse(stdout.trim() || '[]');
  if (!Array.isArray(paths) || paths.some(file => typeof file !== 'string')) throw new Error('无法读取剪贴板文件列表，请重新复制文件。');
  return paths;
}

export async function clipboardFiles(clipboard, { platform = process.platform, readWindowsFiles = windowsFiles } = {}) {
  // Electron 44 maps Finder, Explorer and Linux file-manager selections to
  // text/uri-list. Its asynchronous API replaces the old format/image methods.
  if (modernClipboard(clipboard)) return itemFiles(await clipboard.read(), platform);
  const formats = clipboard.availableFormats();
  if (platform === 'win32') {
    // Do not gate this on availableFormats: a valid CF_HDROP clipboard can have
    // no registered format names at all. GetFileDropList reads clipboard data,
    // not paths from arbitrary text, and supports the entire multi-file list.
    let native;
    try { native = await readWindowsFiles(); }
    catch (error) {
      if (!formats.some(format => fileFormats.test(format)) && formats.some(format => /^(text\/|image\/)/.test(format))) return [];
      throw error;
    }
    if (native.length) return native;
    if (formats.includes('CF_HDROP')) {
      const paths = parseFileDrop(clipboard.readBuffer('CF_HDROP'));
      if (paths.length) return paths;
    }
    if (formats.includes('FileNameW')) return clipboard.readBuffer('FileNameW').toString('utf16le').split('\0').filter(Boolean);
  }
  for (const format of uriFormats) if (formats.includes(format)) {
    const files = parseFileUris(clipboard.readBuffer(format).toString('utf8'), platform);
    if (files.length) return files;
  }
  return [];
}

export async function snapshotClipboard(dataDir, conversation, clipboard, dependencies) {
  if (modernClipboard(clipboard)) {
    const items = await clipboard.read();
    const paths = await itemFiles(items, dependencies?.platform || process.platform);
    if (paths.length) return { attachments: await snapshotFiles(dataDir, conversation, paths), handled: true };
    for (const item of items) {
      const mime = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].find(type => item.types.includes(type));
      if (!mime) continue;
      const blob = await item.getType(mime);
      if (blob.size > MAX_FILE_BYTES) throw new Error('剪贴板图片超过 20 MB 附件上限');
      const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
      const data = new Uint8Array(await blob.arrayBuffer());
      return { attachments: await snapshotData(dataDir, conversation, [{ name: `剪贴板图片-${Date.now()}.${ext}`, mime, data }]), handled: true };
    }
    return { attachments: [], handled: false };
  }
  const paths = await clipboardFiles(clipboard, dependencies);
  if (paths.length) return { attachments: await snapshotFiles(dataDir, conversation, paths), handled: true };
  const image = clipboard.readImage();
  if (image.isEmpty()) return { attachments: [], handled: false };
  return { attachments: await snapshotData(dataDir, conversation, [{ name: `剪贴板图片-${Date.now()}.png`, mime: 'image/png', data: image.toPNG() }]), handled: true };
}
