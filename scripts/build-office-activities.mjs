import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const roles = ['design','creative','engineering','support','operations','marketing'];
const root = fileURLToPath(new URL('../', import.meta.url));
for (const [atlas, columns, rows, names, size] of [
  ['activity-atlas',3,6,['seated','pool','coffee'],192],
  ['desks-only-atlas',3,2,null,256],
]) {
  const source = `${root}/design/office-characters/${atlas}.png`;
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Missing atlas dimensions');
  for (let row=0;row<rows;row++) for(let col=0;col<columns;col++) {
    const left=Math.round(col*width/columns), top=Math.round(row*height/rows);
    const crop={left,top,width:Math.round((col+1)*width/columns)-left,height:Math.round((row+1)*height/rows)-top};
    const name=names ? `${roles[row]}-${names[col]}` : `${roles[row*columns+col]}-workstation`;
    await sharp(source).extract(crop).resize(size,size).webp({quality:88,alphaQuality:100}).toFile(`${root}/public/office/characters/${name}.webp`);
  }
}
