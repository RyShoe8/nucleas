import {employeeAppearance} from '@/lib/companies/employeeIdentity';
import type {DeskFacing} from './officeSimulation';

export const SPRITE={deskNorth:0,deskEast:1,deskSouth:2,deskWest:3,chairSouth:4,chairNorth:5,chairWest:6,chairEast:7,pool:8,tv:9,sofa:10,coffee:11,water:12,books:13,plant:14,flowers:15,printer:16,conference:17,arcade:18,creative:19,house:20,gaming:21,board:22,coat:23};
/** One small atlas. Release its decoded bitmap with the view; reuse it only inside that renderer. */
export class OfficePixels{
 private atlas:HTMLImageElement|null=null;
 private people=new Map<string,HTMLCanvasElement>();
 private fabric=new Map<string,HTMLCanvasElement>();
 ready=false;
 constructor(invalidate:()=>void){const image=new Image();this.atlas=image;image.onload=()=>{this.ready=true;invalidate();};image.src='/office/pixel/furniture.webp';}
 furniture(ctx:CanvasRenderingContext2D,id:number,x:number,y:number,w:number,h=w,tint?:string){
  if(!this.ready||!this.atlas)return false;
  ctx.imageSmoothingEnabled=false;
  if(tint){
   const key=id+':'+tint;let tile=this.fabric.get(key);
   if(!tile){tile=document.createElement('canvas');tile.width=128;tile.height=128;const c=tile.getContext('2d')!;c.imageSmoothingEnabled=false;c.drawImage(this.atlas,id%6*256,Math.floor(id/6)*256,256,256,0,0,128,128);
    const image=c.getImageData(0,0,128,128),d=image.data,target=[1,3,5].map(i=>parseInt(tint.slice(i,i+2),16));
    for(let i=0;i<d.length;i+=4)if(d[i+3]&&d[i+1]>d[i]*1.08&&d[i+1]>d[i+2]*1.06){const light=(d[i]+d[i+1]+d[i+2])/240;for(let k=0;k<3;k++)d[i+k]=Math.min(255,Math.round(target[k]*light));}
    c.putImageData(image,0,0);this.fabric.set(key,tile);if(this.fabric.size>64){const oldest=this.fabric.keys().next().value;if(oldest)this.fabric.delete(oldest);}
   }
   ctx.drawImage(tile,Math.round(x-w/2),Math.round(y-h),w,h);
  }else ctx.drawImage(this.atlas,id%6*256,Math.floor(id/6)*256,256,256,Math.round(x-w/2),Math.round(y-h),w,h);return true;
 }
 person(ctx:CanvasRenderingContext2D,id:string,x:number,y:number,facing:DeskFacing,pose:'walk'|'sit'|'type'|'pool'|'coffee'|'idle'|'game',time:number){
  const frame=pose==='walk'?Math.floor(time*8)%4:pose==='type'||pose==='pool'||pose==='coffee'?Math.floor(time*3)%2:0;
  const key=`${id}:${facing}:${pose}:${frame}`;
  let sprite=this.people.get(key);
  if(!sprite){sprite=this.character(id,facing,pose,frame);this.people.set(key,sprite);if(this.people.size>360){const first=this.people.keys().next().value;if(first)this.people.delete(first);}}
  const a=employeeAppearance(id),h=Math.round(72*a.height),w=Math.round(h*32/48);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,Math.round(x-w/2),Math.round(y-h),w,h);
 }
 private character(id:string,facing:DeskFacing,pose:string,frame:number){
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=48;const c=canvas.getContext('2d')!,a=employeeAppearance(id);
  const rear=facing==='north',side=facing==='west'||facing==='east',sit=pose==='sit'||pose==='type'||pose==='game',step=pose==='walk'?[0,3,0,-3][frame]:0,bob=pose==='walk'&&frame%2?1:0;
  if(facing==='west'){c.translate(32,0);c.scale(-1,1);}
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x,y+bob,w,h);};
  const ink='#243630',pants=a.outfit%2?'#374c52':'#4d5148',shirt=`hsl(${a.shirtHue},34%,${a.outfit===3?35:52}%)`,light=`hsl(${a.shirtHue},32%,66%)`,dark=`hsl(${a.shirtHue},30%,32%)`;
  // Silhouette, trouser creases, separate knees and shoes; opposite arms lead the walking legs.
  if(sit){rect(9,32,14,5,pants);rect(side?20:9,35,side?5:6,8,pants);if(!side)rect(18,35,5,8,pants);rect(side?20:8,42,side?9:8,3,ink);if(!side)rect(18,42,8,3,ink);}
  else {rect(10,32+Math.max(0,step),5,11-Math.abs(step),pants);rect(18,32+Math.max(0,-step),5,11-Math.abs(step),pants);rect(9,43+Math.min(0,step),7,3,ink);rect(18,43+Math.min(0,-step),7,3,ink);rect(11,34,1,7,'#728075');}
  rect(side?11:8,19,side?13:17,15,ink);rect(side?12:9,20,side?11:15,13,shirt);rect(side?12:9,20,3,12,light);rect(side?21:22,21,2,12,dark);
  rect(14,17,6,4,a.skin);if(!rear){rect(13,20,4,2,'#e5e4d2');rect(17,20,4,2,'#e5e4d2');if(a.outfit===0){rect(16,22,2,9,dark);rect(20,25,3,2,'#eee5ce');}else if(a.outfit===2)rect(15,22,5,5,'#cfdfbf');}
  const hand=pose==='type'?frame:0;
  if(side){rect(13,22,5,10+Math.max(0,-step),dark);rect(pose==='type'?20:14,pose==='type'?28+hand:31+Math.max(0,-step),5,4,a.skin);}
  else {rect(6,22+Math.max(0,-step),4,9,shirt);rect(23,22+Math.max(0,step),4,9,dark);rect(6,31+Math.max(0,-step),4,4,a.skin);rect(23,31+Math.max(0,step),4,4,a.skin);}
  // Hair styles, ears, visible profiles, glasses and earrings remain stable for each employee.
  rect(10,5,13,13,ink);rect(9,7,15,9,a.skin);rect(11,6,11,12,a.skin);rect(10,4,13,5,a.hair);rect(9,7,3,7,a.hair);
  if(rear){rect(10,7,13,9,a.hair);rect(12,15,9,3,a.hair);}else if(side){rect(22,10,3,3,a.skin);rect(21,9,1,2,ink);rect(21,15,2,1,'#945d49');}else{rect(13,10,2,2,ink);rect(20,10,2,2,ink);rect(17,14,3,1,'#945d49');rect(22,6,2,4,a.hair);}
  if(a.head%3===1){rect(8,6,3,14,a.hair);if(rear||!side)rect(22,6,3,14,a.hair);}else if(a.head%3===2){rect(10,2,7,3,a.hair);rect(17,3,6,3,a.hair);}
  if(a.accessory===0&&!rear){rect(side?19:11,9,side?5:6,4,ink);if(!side){rect(19,9,5,4,ink);rect(17,10,2,1,ink);}rect(side?20:12,10,3,2,'#a8c5bd');if(!side)rect(20,10,3,2,'#a8c5bd');}
  if(a.accessory===1)rect(9,14,2,2,'#e3c66c');
  if(pose==='coffee'){rect(23,27-frame,5,6,'#f1dec0');rect(28,28-frame,2,3,'#c9a971');}
  if(pose==='pool'){rect(26,16-frame*2,1,28,'#d6b77b');rect(26,14-frame*2,1,3,'#a2cdcb');}
  if(pose==='game'){rect(9,30,15,5,ink);rect(10,29,4,3,a.skin);rect(20,29,4,3,a.skin);rect(14,32,2,1,'#b5c7be');rect(20,32,1,1,'#e7ba64');}
  return canvas;
 }
 dispose(){if(this.atlas)this.atlas.onload=null;this.atlas=null;this.people.clear();this.fabric.clear();}
}
