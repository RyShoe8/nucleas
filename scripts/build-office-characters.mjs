import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Packaging only: the character art and animation poses were generated together.
const atlas = fileURLToPath(new URL('../design/office-characters/walk-atlas.png', import.meta.url));
const idleAtlas = fileURLToPath(new URL('../design/office-characters/idle-atlas.png', import.meta.url));
const furnitureAtlas = fileURLToPath(new URL('../design/office-characters/furniture-atlas.png', import.meta.url));
const output = fileURLToPath(new URL('../public/office/characters/', import.meta.url));
const roles = ['design', 'creative', 'engineering', 'support', 'operations', 'marketing'];
const { width, height } = await sharp(atlas).metadata();
if (!width || !height || width % 4 || height % 6) throw new Error('Expected a 4 × 6 square-cell atlas.');
const cellWidth = width / 4;
const cellHeight = height / 6;
if (cellWidth !== cellHeight) throw new Error('Character cells must be square.');
await mkdir(output, { recursive: true });
const idle = await sharp(idleAtlas).metadata();
if (!idle.width || !idle.height || idle.width / 3 !== idle.height / 2) throw new Error('Expected a 3 × 2 idle atlas.');
const idleCell = idle.width / 3;
const furniture = await sharp(furnitureAtlas).metadata();
if (!furniture.width || !furniture.height || furniture.width / 3 !== furniture.height / 2) throw new Error('Expected a 3 × 2 furniture atlas.');
const furnitureCell = furniture.width / 3;
for (const [row, role] of roles.entries()) {
  const frames = await Promise.all(Array.from({ length: 4 }, (_, column) => sharp(atlas)
    .extract({ left: column * cellWidth, top: row * cellHeight, width: cellWidth, height: cellHeight })
    .resize(192, 192).ensureAlpha().raw().toBuffer()));
  await sharp(idleAtlas).extract({ left: (row % 3) * idleCell, top: Math.floor(row / 3) * idleCell, width: idleCell, height: idleCell }).resize(192, 192)
    .webp({ quality: 88, alphaQuality: 100 }).toFile(`${output}/${role}-idle.webp`);
  await sharp(furnitureAtlas).extract({ left: (row % 3) * furnitureCell, top: Math.floor(row / 3) * furnitureCell, width: furnitureCell, height: furnitureCell }).resize(256, 256)
    .webp({ quality: 88, alphaQuality: 100 }).toFile(`${output}/${role}-desk.webp`);
  // Four walking poses. Furniture lives in the room, never in the sprite.
  await sharp(Buffer.concat(frames), { raw: { width: 192, height: 768, channels: 4, pageHeight: 192 } })
    .gif({ loop: 0, delay: [180, 180, 180, 180], colours: 256, dither: 0.5, effort: 8 })
    .toFile(`${output}/${role}-walking.gif`);
  console.log(`Packaged ${role}: 192px still + four-frame GIF`);
}
