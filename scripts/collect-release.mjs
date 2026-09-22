// Collect CI outputs only after all six native builds pass; reject incomplete releases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const source = path.resolve(process.argv[2] || 'release-input');
const destination = path.resolve(process.argv[3] || 'release-assets');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const expected = new Set(['win-x64', 'win-arm64', 'mac-x64', 'mac-arm64', 'linux-x64', 'linux-arm64']);
const files = [];
function visit(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) visit(full);
    else files.push(full);
  }
}
visit(source);
mkdirSync(destination, { recursive: true });
const checksums = [];
const names = new Set();
async function collect(file, expectedHash) {
  const name = path.basename(file);
  assert.ok(!names.has(name), `Duplicate release artifact: ${name}`);
  const streamHash = createHash('sha256');
  for await (const chunk of createReadStream(file)) streamHash.update(chunk);
  const hash = streamHash.digest('hex');
  if (expectedHash) assert.equal(hash, expectedHash, `Checksum mismatch: ${name}`);
  names.add(name);
  copyFileSync(file, path.join(destination, name));
  checksums.push(`${hash}  ${name}`);
}
for (const report of files.filter(file => file.endsWith('-build.json'))) {
  const manifest = JSON.parse(readFileSync(report, 'utf8'));
  const target = `${manifest.platform}-${manifest.arch}`;
  assert.ok(expected.delete(target), `Unexpected or duplicate target: ${target}`);
  assert.equal(manifest.version, version);
  assert.equal(manifest.nativeRuntimeTest, 'passed');
  assert.equal(manifest.directoryOnly, false);
  assert.equal(manifest.artifacts.length, 2);
  for (const artifact of manifest.artifacts) {
    assert.equal(path.basename(artifact.file), artifact.file, 'Artifacts must be top-level files.');
    await collect(path.join(path.dirname(report), artifact.file), artifact.sha256);
  }
  await collect(report);
}
assert.equal(expected.size, 0, `Missing native targets: ${[...expected].join(', ')}`);
writeFileSync(path.join(destination, 'SHA256SUMS.txt'), `${checksums.sort().join('\n')}\n`);
console.log(`Collected ${names.size} verified files for GrokDesk ${version}.`);
