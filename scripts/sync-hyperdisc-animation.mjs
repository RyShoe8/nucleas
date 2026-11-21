// Explicit, repeatable import of the owned Hyperdisc scene-kit. Never modifies the source repo.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-hyperdisc-animation.mjs <hyperdisc-repo>');
const root = path.resolve('vendor/scene-kit'), library = path.join(root, 'library');
const kit = 'tools/art/scene-kit';
const modules = ['contacts', 'bindings', 'biped', 'foreground', 'prop-action', 'scene', 'sequence', 'sockets', 'rigby'];
const assets = ['catalog.json', 'actors/tiffany.json', 'actors/mick.json', 'performers/keno.json', 'performers/mick.json', 'performers/tango.json', 'sets/beach-lane.json', 'props/disc.json', 'scenes/disc-pass.json', 'scenes/jump-catch.json'].map(f => `${kit}/${f}`);
assets.push('data/story_tower.json', 'assets/art/story/beach-sunset.png', 'assets/art/disc/hyperdisc.png', ...['keno', 'mick', 'tango', 'tiffany'].map(n => `tools/art/story/projects/${n}.rigby`), ...['keno', 'mick', 'tango'].map(n => `assets/art/characters/${n}.json`));
fs.mkdirSync(root, { recursive: true });
const hashes = {};
for (const file of [...assets, ...modules.map(m => `${kit}/${m}.mjs`)]) {
  const bytes = fs.readFileSync(path.join(source, file));
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
  if (!file.endsWith('.mjs')) {
    const out = path.join(library, file); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, bytes);
    continue;
  }
  let text = bytes.toString('utf8').replace("import fs from 'node:fs';", "import { memoryFiles as fs, bytesOf } from './memory-files.mjs';")
    .replace("import path from 'node:path';", "import { memoryPath as path } from './memory-files.mjs';")
    .replace('import { pathToFileURL } from \'node:url\';', '').replace('import { deflateSync } from \'node:zlib\';', '')
    .replaceAll('Buffer.from(', 'bytesOf(')
    .replaceAll('image.readUInt32BE(16)', 'new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(16)')
    .replaceAll('image.readUInt32BE(20)', 'new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(20)')
    .replace("image.subarray(0, 8).equals(bytesOf([137, 80, 78, 71, 13, 10, 26, 10]))", "[137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => image[i] === v)");
  if (file.endsWith('/rigby.mjs')) {
    text = text.replace(/export async function loadRigby\(directory\) \{[\s\S]*?\n\}/, '');
    text = text.replace(/function markerPng\(crc32, solid = false\) \{[\s\S]*?\n\}/, "function markerPng(_crc32, solid = false) { return fs.readFileSync(solid ? '/guide.png' : '/contact.png'); }");
  }
  fs.writeFileSync(path.join(root, path.basename(file)), '// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.\n' + text);
}
// Reuse the exact compiler-authored contact handles, not substitute artwork.
const { loadRigby, makeContactProject, loadSet } = await import(pathToFileURL(path.join(source, kit, 'rigby.mjs')).href);
const rigby = await loadRigby(path.resolve('vendor/rigby'));
const setFile = path.join(source, 'data/story_tower.json'), set = loadSet(setFile);
const contact = makeContactProject(set, rigby, fs.readFileSync(path.resolve(path.dirname(setFile), set.art.file)));
const entries = rigby.unzip(contact.bytes);
for (const name of ['contact.png', 'guide.png']) fs.writeFileSync(path.join(library, name), entries.get('images/' + name));
fs.writeFileSync(path.join(root, 'SOURCE.json'), JSON.stringify({ source: 'Hyperdisc Arena/tools/art/scene-kit', importedAt: '2026-11-21', note: 'Includes the current working-tree choreography. Only Node IO and byte construction are adapted; all motion, IK and socket calculations are preserved.', hashes }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'library-files.json'), JSON.stringify([...assets, 'contact.png', 'guide.png'], null, 2) + '\n');
console.log(`Imported ${modules.length} compiler modules and ${assets.length + 2} library files.`);
