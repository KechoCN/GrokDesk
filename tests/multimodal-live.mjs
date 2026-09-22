// Manual, paid acceptance probe. Never included in npm test. Run only with explicit
// authorization: node tests/multimodal-live.mjs --run
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { GrokAdapter } from '../electron/grok-adapter.mjs';
import { snapshotFiles, promptBlocks } from '../electron/attachments.mjs';
import { redact } from '../electron/acp-client.mjs';

if (!process.argv.includes('--run')) throw new Error('This probe submits one real prompt. Explicit authorization and --run are required.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const imageDiagnostic = process.argv.includes('--image-diagnostic');
await fs.mkdir(artifacts, { recursive: true });
const cwd = await fs.mkdtemp(path.join(artifacts, 'multimodal-live-'));
const reportPath = path.join(artifacts, 'verification', imageDiagnostic ? 'multimodal-image-diagnostic.json' : 'multimodal-live.json');
const id = `live-${randomUUID()}`;
const marker = `NOTE_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const pdfMarker = `PDF_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const report = { startedAt: new Date().toISOString(), cwd, localConversationId: id, expected: imageDiagnostic ? { background: 'red', center: 'white square' } : { color: 'red', textMarker: marker, pdfMarker }, promptsSubmitted: 0, phases: [], permissions: [], toolCalls: [], assistantText: '', cleanup: {} };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, crc]);
}
function redSquarePng() {
  const side = imageDiagnostic ? 128 : 32, stride = side * 3 + 1;
  const header = Buffer.alloc(13); header.writeUInt32BE(side, 0); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(side * stride);
  for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
    const offset = row * stride + 1 + col * 3; pixels[offset] = 255;
    if (imageDiagnostic && row >= 40 && row < 88 && col >= 40 && col < 88) { pixels[offset + 1] = 255; pixels[offset + 2] = 255; }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
function pdfFixture(value) {
  const content = `BT /F1 18 Tf 32 100 Td (${value}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let result = '%PDF-1.4\n', offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const start = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result);
}

let adapter;
adapter = new GrokAdapter({ dependencies: { skipTerminal: true }, emit: event => {
  if (event.type === 'submitted') { report.promptsSubmitted++; report.submittedAt = new Date().toISOString(); console.log('Submitted isolated multimodal prompt once.'); }
  if (event.type === 'phase') report.phases.push({ phase: event.phase, at: new Date().toISOString(), ...(event.error ? { error: redact(event.error) } : {}) });
  if (event.type === 'update' && !event.replay) {
    const update = event.update;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') report.assistantText += update.content.text;
    if (update.sessionUpdate === 'tool_call') report.toolCalls.push({ title: redact(update.title ?? ''), kind: update.kind, status: update.status });
  }
  if (event.type === 'permission') {
    report.permissions.push({ title: redact(event.permission.title), decision: 'declined' });
    // The acceptance probe never changes account policy or broadens tool access.
    // Reads normally allowed by Grok can proceed; additional grants are declined.
    adapter.respondPermission(event.permission.requestId, null);
  }
} });
const writeRequest = adapter.client.write.bind(adapter.client);
adapter.client.write = (connection, message) => {
  if (message.method === 'session/prompt') report.wirePrompt = { blockTypes: message.params.prompt.map(block => block.type), images: message.params.prompt.filter(block => block.type === 'image').map(block => ({ mimeType: block.mimeType, bytes: Buffer.from(block.data, 'base64').length, sha256: createHash('sha256').update(Buffer.from(block.data, 'base64')).digest('hex') })) };
  return writeRequest(connection, message);
};

let deadline;
try {
  await fs.writeFile(path.join(cwd, 'square.png'), redSquarePng());
  await fs.writeFile(path.join(cwd, 'note.txt'), marker + '\n');
  await fs.writeFile(path.join(cwd, 'document.pdf'), pdfFixture(pdfMarker));
  const engine = await adapter.start({ cwd });
  report.engine = { state: engine.state, version: engine.version, auth: engine.auth };
  if (engine.state !== 'ready') throw new Error(engine.error ?? 'Grok engine is unavailable');
  const session = await adapter.open({ id, cwd });
  report.nativeSessionId = session.engineSessionId;
  report.capabilities = { image: session.supportsImages, embeddedContext: session.supportsEmbeddedContext };
  report.model = session.currentModelId;
  const conversation = { id, attachments: [] };
  const attachments = await snapshotFiles(path.join(cwd, 'data'), conversation, (imageDiagnostic ? ['square.png'] : ['square.png', 'note.txt', 'document.pdf']).map(name => path.join(cwd, name)));
  const sourceImage = await fs.readFile(path.join(cwd, 'square.png'));
  const snapshotImage = await fs.readFile(attachments.find(file => file.name === 'square.png').path);
  report.fixtureIntegrity = { sourcePixelRgb: [255, 0, 0], width: imageDiagnostic ? 128 : 32, height: imageDiagnostic ? 128 : 32, snapshotByteIdentical: sourceImage.equals(snapshotImage), sourceImageSha256: createHash('sha256').update(sourceImage).digest('hex') };
  const prompt = imageDiagnostic ? 'Describe the large background color and the central shape/color in this image. One short line. Inspect the image directly, without tools.' : 'Read only these three attachments. Reply with the square color, exact marker in note.txt, and exact marker in document.pdf. One short line. Do not modify files or access the network.';
  const blocks = await promptBlocks(prompt, attachments, report.capabilities);
  report.prompt = prompt;
  report.attachments = attachments.map(file => ({ name: file.name, mime: file.mime, kind: file.kind, bytes: file.size }));
  report.protocol = blocks.map(block => ({ type: block.type, mime: block.mimeType ?? block.resource?.mimeType, bytes: block.data ? Buffer.from(block.data, 'base64').length : block.resource?.blob ? Buffer.from(block.resource.blob, 'base64').length : Buffer.byteLength(block.text ?? block.resource?.text ?? ''), sha256: createHash('sha256').update(block.data ?? block.resource?.blob ?? block.text ?? block.resource?.text ?? '').digest('hex') }));
  const completed = adapter.prompt(id, blocks);
  const timeout = new Promise((_, reject) => { deadline = setTimeout(() => { try { adapter.cancel(id); } catch {} reject(new Error('Live acceptance exceeded three minutes; cancelled without resending.')); }, 180000); });
  report.response = await Promise.race([completed, timeout]);
  report.checks = imageDiagnostic ? { backgroundColor: /\bred\b|红/.test(report.assistantText.toLowerCase()), centerColor: /\bwhite\b|白/.test(report.assistantText.toLowerCase()), centerShape: /\bsquare\b|方形|方块/.test(report.assistantText.toLowerCase()) } : { imageColor: /\bred\b|红/.test(report.assistantText.toLowerCase()), textMarker: report.assistantText.includes(marker), pdfMarker: report.assistantText.includes(pdfMarker) };
  report.checks.imageBytesUnchangedOnWire = report.wirePrompt.images[0].sha256 === report.fixtureIntegrity.sourceImageSha256;
  report.status = Object.values(report.checks).every(Boolean) ? 'verified' : 'partial';
} catch (error) {
  report.status = 'failed'; report.error = redact(error.message); if (error.code !== undefined) report.errorCode = error.code;
} finally {
  clearTimeout(deadline);
  if (adapter.sessions.has(id)) {
    try { await adapter.delete(id); report.cleanup.nativeSessionDeleted = true; }
    catch (error) { report.cleanup.nativeSessionDeleted = false; report.cleanup.error = redact(error.message); }
  }
  await adapter.dispose(); report.cleanup.ownedProcessesDisposed = true;
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, promptsSubmitted: report.promptsSubmitted, checks: report.checks, assistantText: report.assistantText, error: report.error, cleanup: report.cleanup, reportPath }));
}
