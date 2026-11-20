import {employeeAppearance} from '@/lib/companies/employeeIdentity';
import type {DeskFacing} from './officeSimulation';
export type CharacterPose='walk'|'sit'|'type'|'pool'|'coffee'|'idle'|'game';
export const CHARACTER_SIZE={width:80,height:136};
/** Hand-drawn, shaded sprite parts. Frames are baked once by OfficePixels, never drawn per tick. */
export function characterFrame(id:string,facing:DeskFacing,pose:CharacterPose,frame:number){
 const canvas=document.createElement('canvas');canvas.width=80;canvas.height=136;
 const c=canvas.getContext('2d')!,a=employeeAppearance(id),side=facing==='east'||facing==='west',rear=facing==='north',seated=['sit','type','game'].includes(pose);
 const phase=Math.sin(frame*Math.PI/4),stride=pose==='walk'?phase:0,bob=pose==='walk'?Math.abs(Math.sin(frame*Math.PI/2))*1.5:0,work=pose==='type'||pose==='game',sip=pose==='coffee';
 if(facing==='west'){c.translate(80,0);c.scale(-1,1);}
 const shade=(hex:string,t:number)=>'#'+[1,3,5].map(i=>Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*t)).toString(16).padStart(2,'0')).join('');
 const ink='#253035',shirt=`hsl(${a.shirtHue} 31% 49%)`,shine=`hsl(${a.shirtHue} 33% 66%)`,shadow=`hsl(${a.shirtHue} 32% 31%)`,deep=`hsl(${a.shirtHue} 29% 24%)`;
 const skin=a.skin,skinShade=shade(skin,.78),skinLight=shade(skin,1.12),hair=a.hair,hairShade=shade(hair,.66),hairLight=shade(hair,1.32),pants=a.outfit%2?'#4c5c6b':'#655c51';
 const offset=(seated?19:0)+bob;
 const poly=(points:number[][],fill:string,outline=ink,width=1.5)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(Math.round(x),Math.round(y+offset)):c.moveTo(Math.round(x),Math.round(y+offset)));c.closePath();c.fillStyle=fill;c.fill();if(outline){c.strokeStyle=outline;c.lineWidth=width;c.lineJoin='round';c.stroke();}};
 const rect=(x:number,y:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y+offset),w,h);};
 const line=(points:number[][],color:string,width=1)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y+offset):c.moveTo(x,y+offset));c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();};
 const limb=(points:number[][],color:string,width:number)=>{line(points,ink,width+3);line(points,color,width);};
 // Back leg first. Knees lead the lifted foot; heels roll through an eight-frame gait.
 for(const [i,sign] of [[0,-1],[1,1]]){
  const x=side?39:31+i*18,lift=pose==='walk'?Math.max(0,Math.cos(frame*Math.PI/4+(sign<0?Math.PI:0)))*8:0;
  const kneeX=seated?(side?58:x+sign*2):x+(side?stride*sign*11+lift*.35:sign*2),kneeY=seated?85:103-lift;
  const footX=seated?(side?60:x+sign*3):x+(side?stride*sign*17:stride*sign*3),footY=seated?106:127-lift;
  limb([[x,77],[kneeX,kneeY],[footX,footY-5]],i===0?shade(pants,.78):pants,side?10:12);
  line([[x-2,81],[kneeX-2,kneeY-2],[footX-2,footY-8]],i===0?'#58636a':'#8a8c88',2);
  line([[kneeX-3,kneeY+2],[kneeX+3,kneeY-1]],shade(pants,.65),2);
  poly([[footX-6,footY-7],[footX+4,footY-7],[footX+(side?13:7),footY-2],[footX+(side?14:8),footY+2],[footX-7,footY+2]],'#35444b');
  line([[footX-6,footY],[footX+(side?12:6),footY]],'#b1b8b2',2);line([[footX-1,footY-5],[footX+5,footY-4]],'#d2d0b7',1);
 }
 const arm=(back:boolean)=>{
  const sign=back?-1:1,sx=side?(back?37:43):(back?24:56),sy=49;
  const ex=work?(side?62:back?31:51):sip&&!back?59:sx+(side?-stride*sign*10:sign*4),ey=work?72+(pose==='type'?(frame%2)*(back?2:-2):0):sip&&!back?41+frame%2*6:79;
  const elbowX=work?(side?48:sx):sip&&!back?63:sx+(side?-stride*sign*6:sign*4),elbowY=work?65:sip&&!back?65:65;
  limb([[sx,sy],[elbowX,elbowY],[ex,ey]],back?shadow:shirt,9);
  line([[sx-2,sy+2],[elbowX-2,elbowY],[ex-2,ey-5]],back?shirt:shine,2);
  line([[elbowX-3,elbowY+1],[elbowX+2,elbowY-1]],deep,1.5);line([[ex-4,ey-4],[ex+4,ey-4]],shine,2);
  poly([[ex-4,ey-2],[ex+3,ey-2],[ex+5,ey+2],[ex+3,ey+7],[ex-3,ey+7],[ex-5,ey+2]],skin,skinShade,1);
  line([[ex-2,ey+2],[ex-2,ey+5],[ex+2,ey+5]],skinShade);rect(ex-2,ey,3,2,skinLight);
  if(a.accessory===2&&!back){line([[ex-4,ey-4],[ex+4,ey-4]],ink,3);rect(ex-1,ey-6,4,4,'#b7cbbf');}
 };
 arm(true);
 // Fitted silhouette, shoulder seams, fabric planes and small material highlights.
 poly(side?[[32,43],[44,42],[52,49],[53,69],[49,80],[30,80],[29,60]]:[[28,43],[37,41],[47,41],[54,44],[60,52],[56,70],[57,80],[23,80],[24,67],[21,51]],shirt);
 poly(side?[[44,45],[51,50],[52,70],[48,78],[44,78]]:[[50,45],[58,52],[53,69],[55,77],[48,77],[46,61]],shadow,'');
 poly(side?[[33,46],[37,44],[38,72],[33,75]]:[[28,47],[33,44],[36,62],[32,75],[26,75]],shine,'');
 line([[side?32:25,78],[side?48:55,78]],deep,2);
 line([[side?32:27,66],[side?40:35,69]],shadow,2);line([[side?42:48,72],[side?48:54,69]],shine,1.5);
 poly([[35,35],[46,35],[46,45],[41,49],[34,44]],skinShade,'');rect(36,37,6,6,skin);
 c.save();c.beginPath();
 (side?[[32,43],[44,42],[52,49],[53,69],[49,80],[30,80],[29,60]]:[[28,43],[37,41],[47,41],[54,44],[60,52],[56,70],[57,80],[23,80],[24,67],[21,51]]).forEach(([x,y],i)=>i?c.lineTo(x,y+offset):c.moveTo(x,y+offset));c.closePath();c.clip();
 if(!rear){
  poly([[32,44],[36,42],[41,49],[37,54]],'#e8e1cb',shadow,1);poly([[46,43],[50,46],[45,54],[41,49]],'#c9cebd',shadow,1);
  if(a.outfit===0){poly([[40,49],[43,50],[45,69],[41,73],[38,69]],deep,'');rect(48,58,5,6,shine);rect(49,58,3,1,'#e9dfc8');}
  if(a.outfit===1){line([[35,48],[34,62]],'#e2dbbb');line([[48,48],[49,62]],'#e2dbbb');poly([[32,68],[47,68],[50,75],[29,75]],shadow,'');}
  if(a.outfit===2){poly([[29,45],[35,44],[38,77],[24,77]],deep,'');poly([[50,45],[54,48],[56,77],[47,77]],deep,'');line([[34,47],[30,57],[36,59]],shine,2);}
  if(a.outfit===3){line([[41,50],[41,76]],shadow);for(let i=0;i<4;i++)rect(42,54+i*6,1,2,'#e4ddc3');poly([[28,56],[35,56],[35,64],[31,66],[28,63]],shadow,'');}
  if(a.outfit===4)for(let i=0;i<3;i++){line([[26,55+i*8],[53,55+i*8]],shine,3);}
  if(a.outfit===5){line([[29,49],[31,71]],shine);poly([[45,55],[51,55],[51,64],[48,66],[45,63]],deep,'');rect(47,57,2,5,'#b9d9c2');}
 }else{line([[29,49],[48,49]],shine,1);line([[37,53],[36,67]],shadow,2);if(a.outfit===1)poly([[30,43],[49,43],[48,52],[40,56],[32,51]],shadow,deep,1);}
 c.restore();arm(false);
 // Sculpted face with ears, brows, cheek light, nose and a readable jaw rather than a block head.
 poly([[27,17],[30,10],[45,8],[52,13],[55,24],[51,35],[45,40],[35,40],[28,33]],skin);
 poly([[46,13],[53,18],[53,29],[48,37],[42,39],[43,32],[47,27]],skinShade,'');
 poly([[29,19],[34,15],[43,15],[41,22],[33,24],[29,29]],skinLight,'');
 poly([[26,23],[29,21],[31,26],[29,31],[26,29]],skin,skinShade,1);
 if(rear){poly([[27,15],[31,10],[45,9],[52,14],[55,24],[51,35],[46,39],[34,37],[28,30]],hair,hairShade);line([[33,16],[30,25],[35,33]],hairLight,2);line([[48,16],[50,29],[46,34]],hairShade,3);}
 else if(side){poly([[51,22],[54,23],[59,28],[54,29],[53,34],[47,38],[42,37]],skin,skinShade,1);line([[49,22],[54,23]],hairShade,2);rect(51,24,4,2,'#efe8d7');rect(53,24,2,3,ink);line([[53,32],[56,32]],'#915e50');line([[48,35],[51,35]],skinLight,2);}
 else{line([[30,22],[36,21]],hairShade,2);line([[44,21],[49,23]],hairShade,2);rect(31,24,6,3,'#ece8d9');rect(44,24,6,3,'#ece8d9');rect(34,24,2,3,ink);rect(46,24,2,3,ink);line([[40,24],[39,30],[42,30]],skinShade,1.5);line([[36,34],[43,34],[45,33]],'#865c52',1);rect(37,36,6,1,skinLight);}
 // Six stable hair silhouettes, with directional strands and layered highlights.
 const hairShapes=[[[25,20],[25,10],[30,5],[41,4],[48,1],[53,7],[52,15],[43,12],[33,16],[30,24]],[[24,32],[23,14],[28,6],[44,4],[53,10],[57,36],[50,43],[49,20],[42,13],[32,18],[31,42],[23,39]],[[24,22],[22,14],[25,10],[24,7],[30,6],[32,2],[38,5],[43,2],[48,5],[53,6],[56,12],[53,22],[48,16],[33,16]],[[24,21],[25,10],[33,5],[34,1],[45,0],[49,5],[52,10],[53,23],[48,14],[31,15],[30,25]],[[25,23],[24,13],[29,7],[43,5],[52,9],[54,15],[43,13],[34,15],[30,21],[30,29],[26,28]],[[25,21],[26,12],[31,8],[45,7],[52,12],[53,17],[47,15],[32,16],[29,25]]];
 poly(hairShapes[a.head],hair,hairShade,2);
 line([[28,12],[34,9],[44,8]],hairLight,2);line([[30,15],[36,12],[43,11]],hairLight,1);line([[27,17],[27,23]],hairShade,2);
 if(a.head===1){line([[26,20],[26,34]],hairLight,2);line([[52,22],[53,36]],hairLight,1);}
 if(a.head===2)for(let i=0;i<5;i++)line([[26+i*5,9],[28+i*5,7],[30+i*5,10]],i%2?hairLight:hairShade,2);
 if(a.head===3){line([[36,3],[43,3],[46,6]],hairLight,2);}
 if(a.accessory===0&&!rear){line(side?[[48,23],[56,23],[56,29],[48,29],[48,23]]:[[29,23],[38,23],[38,29],[29,29],[29,23]],ink,1.8);if(!side){line([[43,23],[51,23],[51,29],[43,29],[43,23]],ink,1.8);line([[38,25],[43,25]],ink,1);}line([[side?50:31,24],[side?53:34,24]],'#c2e0dc',1);}
 if(a.accessory===1){rect(26,30,2,4,'#e0bf71');rect(26,30,1,2,'#fff0c5');}
 if(a.accessory===3&&!rear){line(side?[[47,34],[50,36],[54,34]]:[[33,33],[36,38],[44,38],[48,33]],hairShade,2);}
 if(sip){const y=36+frame%2*6;poly([[55,y],[66,y],[65,y+12],[57,y+12]],'#eadcc0','#8d866e',1);line([[66,y+2],[70,y+3],[70,y+8],[66,y+9]],'#d5c5a6',2);rect(57,y+1,7,2,'#775744');}
 if(pose==='game'){poly([[27,70],[51,70],[56,77],[52,81],[46,77],[32,77],[27,81],[23,77]],'#35464c');line([[28,73],[28,77]],'#c2cbbd',2);line([[26,75],[30,75]],'#c2cbbd',2);rect(49,73,2,2,'#eab884');rect(52,75,2,2,'#9bb9a6');}
 if(pose==='pool'){line([[61,29-frame%2*3],[69,123]],'#3d4339',4);line([[61,29-frame%2*3],[69,123]],'#c7aa75',2);line([[61,27-frame%2*3],[61,31-frame%2*3]],'#9dc8c3',2);}
 return canvas;
}
