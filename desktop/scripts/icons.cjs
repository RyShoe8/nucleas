const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
async function icons(){
 const root=path.resolve(__dirname,'..'),svg=await fs.readFile(path.join(root,'assets/nucleas.svg'));
 const sizes=[16,20,24,32,40,48,64,128,256],images=await Promise.all(sizes.map(size=>sharp(svg).resize(size,size).png().toBuffer()));
 const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
 sizes.forEach((size,i)=>{const p=6+i*16;header[p]=header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length;});
 await Promise.all([fs.writeFile(path.join(root,'renderer/icon.ico'),Buffer.concat([header,...images])),sharp(svg).png().toFile(path.join(root,'renderer/icon.png')),fs.writeFile(path.join(root,'renderer/tray.png'),images[3])]);
}
module.exports={icons};
