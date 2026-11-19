import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Slice the original generated atlas; keep furnishings independent from room architecture.
const source = fileURLToPath(new URL('../design/office-characters/amenities-atlas.png', import.meta.url));
const output = fileURLToPath(new URL('../public/office/amenities/', import.meta.url));
const names = ['conference', 'projector', 'couch', 'coffee', 'water', 'plant', 'pool', 'gaming', 'reception'];
const { width, height } = await sharp(source).metadata();
if (!width || !height || width !== height) throw new Error('Expected a square three-by-three atlas.');
await mkdir(output, { recursive: true });
for (const [index, name] of names.entries()) {
    const left = Math.round((index % 3) * width / 3);
    const top = Math.round(Math.floor(index / 3) * height / 3);
    const right = Math.round(((index % 3) + 1) * width / 3);
    const bottom = Math.round((Math.floor(index / 3) + 1) * height / 3);
    await sharp(source).extract({ left, top, width: right - left, height: bottom - top })
        .resize(384, 384).webp({ quality: 85, alphaQuality: 100 }).toFile(`${output}/${name}.webp`);
}
