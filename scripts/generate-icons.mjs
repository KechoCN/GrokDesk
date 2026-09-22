// Wrap the existing, attributed PNG in ICNS without changing any pixels.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = new URL('../Assets/', import.meta.url);
const png = await readFile(new URL('grok-mobile.png', assets));
if (png.subarray(1, 4).toString() !== 'PNG' || png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) {
  throw new Error('Expected the attributed 512 × 512 PNG source.');
}
const icns = Buffer.alloc(png.length + 16);
icns.write('icns', 0); icns.writeUInt32BE(icns.length, 4);
icns.write('ic09', 8); icns.writeUInt32BE(png.length + 8, 12);
png.copy(icns, 16);
await writeFile(new URL('GrokDesk.icns', assets), icns);
console.log(`macOS icon container generated in ${fileURLToPath(assets)}`);
