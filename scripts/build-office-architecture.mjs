import sharp from 'sharp';
import fs from 'node:fs/promises';
const out='public/office/architecture';await fs.mkdir(out,{recursive:true});
for(const [index,name] of ['studio','client','commons'].entries()) {
    // Separate wall and floor bands let room sizes vary without stretching windows into the aisle.
    await sharp('design/office-characters/architecture-atlas.png').extract({left:0,top:index*418,width:1254,height:184}).resize(1254,184).webp({quality:87}).toFile(`${out}/${name}-wall.webp`);
    await sharp('design/office-characters/architecture-atlas.png').extract({left:0,top:index*418+184,width:1254,height:234}).webp({quality:84}).toFile(`${out}/${name}-floor.webp`);
}
