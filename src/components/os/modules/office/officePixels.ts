import {employeeAppearance} from '@/lib/companies/employeeIdentity';
import {characterFrame,CHARACTER_SIZE,type CharacterPose} from './officeCharacter';
import type {DeskFacing} from './officeSimulation';

export const SPRITE={deskNorth:0,deskEast:1,deskSouth:2,deskWest:3,chairSouth:4,chairNorth:5,chairWest:6,chairEast:7,pool:8,tv:9,sofa:10,coffee:11,water:12,books:13,plant:14,flowers:15,printer:16,conference:17,arcade:18,creative:19,house:20,gaming:21,board:22,coat:23};
/** Independent object images, shared by every copy in this view. Release decoded art on teardown. */
export class OfficePixels{
 private images=new Map<number,HTMLImageElement>();
 private people=new Map<string,HTMLCanvasElement>();
 private fabric=new Map<string,HTMLCanvasElement>();
 ready=false;
 constructor(invalidate:()=>void){
  const names=['desk-north','desk-east','desk-south','desk-west','chair-south','chair-north','chair-west','chair-east','pool','tv','sofa','coffee','water','books','plant','flowers','printer','conference','arcade','creative','house','gaming','board','coat'];
  names.forEach((name,id)=>{if(id===SPRITE.creative||id===SPRITE.board)return;const image=new Image();image.onload=()=>{this.ready=true;invalidate();};image.src='/office/pixel/objects/'+name+'.webp';this.images.set(id,image);});
 }
 furniture(ctx:CanvasRenderingContext2D,id:number,x:number,y:number,w:number,h=w,tint?:string){
  const image=this.images.get(id);if(!image?.complete||!image.naturalWidth)return false;
  ctx.imageSmoothingEnabled=false;
  if(tint){
   const key=id+':'+tint;let tile=this.fabric.get(key);
   if(!tile){tile=document.createElement('canvas');tile.width=128;tile.height=128;const c=tile.getContext('2d')!;c.imageSmoothingEnabled=false;c.drawImage(image,0,0,256,256,0,0,128,128);
    const pixels=c.getImageData(0,0,128,128),d=pixels.data,target=[1,3,5].map(i=>parseInt(tint.slice(i,i+2),16));
    for(let i=0;i<d.length;i+=4)if(d[i+3]&&d[i+1]>d[i]*1.08&&d[i+1]>d[i+2]*1.06){const light=(d[i]+d[i+1]+d[i+2])/240;for(let k=0;k<3;k++)d[i+k]=Math.min(255,Math.round(target[k]*light));}
    c.putImageData(pixels,0,0);this.fabric.set(key,tile);if(this.fabric.size>64){const oldest=this.fabric.keys().next().value;if(oldest)this.fabric.delete(oldest);}
   }
   ctx.drawImage(tile,Math.round(x-w/2),Math.round(y-h),w,h);
  }else ctx.drawImage(image,0,0,256,256,Math.round(x-w/2),Math.round(y-h),w,h);return true;
 }
 person(ctx:CanvasRenderingContext2D,id:string,x:number,y:number,facing:DeskFacing,pose:CharacterPose,time:number){
  const frame=pose==='walk'?Math.floor(time*10+employeeAppearance(id).shirtHue/60)%8:pose==='type'||pose==='pool'||pose==='coffee'?Math.floor(time*3)%2:0;
  const key=`${id}:${facing}:${pose}:${frame}`;
  let sprite=this.people.get(key);
  if(!sprite){sprite=characterFrame(id,facing,pose,frame);this.people.set(key,sprite);if(this.people.size>192){const first=this.people.keys().next().value;if(first)this.people.delete(first);}}
  const a=employeeAppearance(id),h=Math.round(94*a.height),w=Math.round(h*CHARACTER_SIZE.width/CHARACTER_SIZE.height);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,Math.round(x-w/2),Math.round(y-h),w,h);
 }
 dispose(){for(const image of this.images.values())image.onload=null;this.images.clear();this.people.clear();this.fabric.clear();}
}
