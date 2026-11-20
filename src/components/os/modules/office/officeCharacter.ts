import {employeeAppearance} from '@/lib/companies/employeeIdentity';
import type {DeskFacing} from './officeSimulation';
export type CharacterPose='walk'|'sit'|'type'|'pool'|'coffee'|'idle'|'game';
/** Tiny directional pixel sprites. Articulated knees/elbows, stable identities and cached frames. */
export function characterFrame(id:string,facing:DeskFacing,pose:CharacterPose,frame:number){
 const canvas=document.createElement('canvas');canvas.width=40;canvas.height=64;const c=canvas.getContext('2d')!,a=employeeAppearance(id);
 const side=facing==='east'||facing==='west',rear=facing==='north',seated=['sit','type','game'].includes(pose),phase=[0,.72,1,0,-.72,-1][frame%6],stride=pose==='walk'?phase:0,bob=pose==='walk'&&[1,4].includes(frame)?1:0;
 if(facing==='west'){c.translate(40,0);c.scale(-1,1);}
 const ink='#223232',shirt=`hsl(${a.shirtHue} 32% 49%)`,light=`hsl(${a.shirtHue} 30% 65%)`,dark=`hsl(${a.shirtHue} 30% 31%)`,pants=a.outfit%2?'#3c505c':'#4f4b46';
 const shade=(hex:string,t:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
 const skinShadow=shade(a.skin,.78),hairShadow=shade(a.hair,.65);
 const rect=(x:number,y:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y+bob+(seated?10:0)),w,h);};
 const limb=(x:number,y:number,kx:number,ky:number,ex:number,ey:number,color:string,width=5)=>{
  const segment=(ax:number,ay:number,bx:number,by:number)=>{const steps=Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay)));for(let i=0;i<=steps;i++){const t=steps?i/steps:0;rect(ax+(bx-ax)*t-width/2,ay+(by-ay)*t-width/2,width,width,color);}};
  segment(x,y,kx,ky);segment(kx,ky,ex,ey);
 };
 // Legs bend at the knee rather than stretching. The lifted foot advances, the planted foot supports the body.
 for(const [i,sign] of [[0,-1],[1,1]]){
  const lift=seated?0:Math.max(0,stride*sign)*4,x=side?20:15+i*10,footX=seated?(side?29:x):x+(side?stride*sign*8:stride*sign*2),footY=seated?51:60-lift;
  limb(x,43,seated?(side?28:x):x+(side?stride*sign*4:0),seated?46:51-lift,footX,footY,i===0?shade(pants,.75):pants,6);
  rect(footX-3,footY,side?10:8,3,ink);rect(footX-1,footY,side?7:5,1,'#899491');
 }
 rect(side?12:9,24,side?18:23,20,ink);rect(side?13:10,25,side?16:21,18,shirt);rect(side?13:10,26,3,16,light);rect(side?27:28,27,3,15,dark);
 rect(17,21,7,5,skinShadow);
 if(!rear){rect(16,25,4,3,'#e5e3ce');rect(22,25,4,3,'#e5e3ce');
  if(a.outfit===0){rect(20,27,3,14,dark);rect(26,31,3,3,'#f2e8ce');}
  if(a.outfit===1){rect(18,27,1,9,'#dfdfce');rect(25,27,1,9,'#dfdfce');rect(16,38,10,2,dark);}
  if(a.outfit===2){rect(14,27,3,16,dark);rect(25,27,3,16,dark);rect(19,29,4,9,'#e1d6b8');}
  if(a.outfit===3){for(let k=0;k<4;k++)rect(21,29+k*3,1,1,'#e7dfc9');rect(14,31,4,4,dark);}
  if(a.outfit===4){rect(12,30,17,2,light);rect(12,36,17,2,light);}
 }
 const work=pose==='type'||pose==='game',sip=pose==='coffee';
 for(const [i,sign] of [[0,-1],[1,1]]){
  const sx=side?19:9+i*23,sy=28,ex=work?(side?29:14+i*14):sip&&i===1?28:sx+(side?-stride*sign*6:sign*2),ey=work?36+(pose==='type'?frame%2:0):sip&&i===1?26+frame%2*3:43;
  if(side&&i===0)continue;
  limb(sx,sy,work?(side?24:sx):sx,work?35:36,ex,ey,i===0?light:dark,5);
  rect(ex-2,ey-1,5,4,a.skin);rect(ex-2,ey+2,4,1,skinShadow);
  if(a.accessory===2&&i===1)rect(ex-2,ey-3,5,2,'#d6caaa');
 }
 // Head silhouettes differ as well as palettes: curls, side part, bob, bun and quiff.
 rect(11,6,18,16,ink);rect(10,10,20,9,a.skin);rect(12,7,16,15,a.skin);rect(12,20,14,2,skinShadow);rect(11,5,18,5,a.hair);rect(10,8,3,8,hairShadow);
 if(rear){rect(11,8,18,11,a.hair);rect(13,18,14,4,hairShadow);}else if(side){rect(28,12,3,4,a.skin);rect(27,11,2,2,'#faf0dc');rect(28,11,1,2,ink);rect(26,18,3,1,skinShadow);rect(15,12,3,5,skinShadow);}else{rect(14,12,3,2,'#f4ebd9');rect(24,12,3,2,'#f4ebd9');rect(15,12,1,2,ink);rect(25,12,1,2,ink);rect(20,13,2,4,skinShadow);rect(19,19,5,1,'#855144');}
 if(a.head===0){rect(12,3,9,3,a.hair);rect(17,2,10,3,a.hair);rect(24,5,4,4,hairShadow);}
 if(a.head===1){rect(8,7,4,17,a.hair);rect(28,7,4,17,a.hair);rect(10,22,4,3,hairShadow);}
 if(a.head===2){for(let k=0;k<5;k++)rect(9+k*4,3+k%2,5,5,k%2?a.hair:hairShadow);}
 if(a.head===3){rect(14,1,11,5,a.hair);rect(17,0,5,2,hairShadow);rect(27,7,3,12,a.hair);}
 if(a.head===4){rect(10,6,18,3,hairShadow);rect(12,5,11,3,a.hair);rect(10,8,5,3,a.hair);}
 if(a.head===5){rect(11,3,17,4,hairShadow);rect(13,3,11,2,a.hair);rect(28,8,2,5,hairShadow);}
 if(a.accessory===0&&!rear){rect(side?25:12,11,side?6:7,5,ink);if(!side){rect(22,11,7,5,ink);rect(19,12,3,1,ink);}rect(side?26:13,12,4,2,'#a2c6c5');if(!side)rect(23,12,4,2,'#a2c6c5');}
 if(a.accessory===1)rect(10,17,2,3,'#e6c16c');
 if(sip){rect(27,23+frame%2*3,6,7,'#eee3cf');rect(33,24+frame%2*3,2,4,'#bcab8a');}
 if(pose==='game'){rect(12,36,17,5,'#23353a');rect(14,37,3,1,'#b9c9bc');rect(24,37,1,1,'#e5bd78');}
 if(pose==='pool'){rect(32,17-frame%2*2,2,42,'#d2b782');rect(32,15-frame%2*2,2,3,'#91c5c0');}
 return canvas;
}
