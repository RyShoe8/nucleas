import {employeeAppearance} from '@/lib/companies/employeeIdentity';
import {CHARACTER_ROLES} from './characters';
const variants=new Map<string,HTMLCanvasElement>();
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
/** Bake clothing, hair, skin and accessories once. Animation reuses these small atlases. */
export function appearanceTexture(key:string,rear:boolean,regions:number[][],textures:Map<string,HTMLImageElement>){
 const id=`${key}:${rear}`,found=variants.get(id);if(found){variants.delete(id);variants.set(id,found);return found;}
 const look=employeeAppearance(key),suffix=rear?'-rear':'';
 const head=textures.get(CHARACTER_ROLES[look.head]+suffix),body=textures.get(CHARACTER_ROLES[look.outfit]+suffix);if(!head||!body)return null;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!;
 regions.forEach(([x,y,w,h],part)=>c.drawImage(part===9?head:body,x,y,w,h,x/2,y/2,w/2,h/2));
 const pixels=c.getImageData(0,0,256,256),d=pixels.data,skin=rgb(look.skin),hair=rgb(look.hair);
 c.fillStyle=`hsl(${look.shirtHue} 32% 46%)`;c.fillRect(250,250,1,1);const shirt=[...c.getImageData(250,250,1,1).data].slice(0,3);
 for(let part=0;part<10;part++){
  const [sx,sy,sw,sh]=regions[part],headPart=part===9;
  for(let y=Math.ceil(sy/2);y<(sy+sh)/2;y++)for(let x=Math.ceil(sx/2);x<(sx+sw)/2;x++){
   const i=(y*256+x)*4;if(d[i+3]<20)continue;
   const r=d[i],g=d[i+1],b=d[i+2],l=(r*.21+g*.72+b*.07)/255;
   const warm=r>g*1.08&&g>b*1.06&&r>80,relativeY=(y-sy/2)/(sh/2);
   let target:number[]|undefined;
   if(headPart){if(warm&&relativeY>.38&&l>.35&&!rear)target=skin;else if(relativeY<.65&&l<.8)target=hair;}
   else if([6,8].includes(part)&&warm)target=skin;
   else if([4,5,7].includes(part)&&!(warm&&relativeY<.2))target=shirt;
   if(target){const shade=Math.max(.28,Math.min(1.35,l/(target===hair ? .38 : .6)));for(let k=0;k<3;k++)d[i+k]=Math.min(255,Math.round(target[k]*shade));}
  }
 }
 c.putImageData(pixels,0,0);
 const [hx,hy,hw,hh]=regions[9];
 if(!rear&&look.accessory===0){c.strokeStyle='#293c36';c.lineWidth=1.2;c.strokeRect(hx/2+hw*.13,hy/2+hh*.29,hw*.10,hh*.065);c.strokeRect(hx/2+hw*.27,hy/2+hh*.29,hw*.10,hh*.065);c.beginPath();c.moveTo(hx/2+hw*.23,hy/2+hh*.31);c.lineTo(hx/2+hw*.27,hy/2+hh*.31);c.stroke();}
 if(look.accessory===1){c.strokeStyle='#bed0b3';c.lineWidth=2;c.beginPath();c.arc(hx/2+hw/4,hy/2+hh*.25,hw*.19,Math.PI,Math.PI*2);c.stroke();c.fillStyle='#2f4c43';c.fillRect(hx/2+hw*.05,hy/2+hh*.24,4,8);c.fillRect(hx/2+hw*.41,hy/2+hh*.24,4,8);}
 if(look.accessory===2&&!rear){const [x,y,w]=regions[4];c.fillStyle='#d9c891';c.fillRect(x/2+w*.30,y/2+14,5,7);}
 // At most 20 MiB, shared by all people and released when the scene unmounts.
 while(variants.size>=80){const oldest=variants.keys().next().value!;const old=variants.get(oldest)!;old.width=old.height=0;variants.delete(oldest);}
 variants.set(id,canvas);return canvas;
}
export function releaseOfficeAppearances(){for(const c of variants.values())c.width=c.height=0;variants.clear();}
