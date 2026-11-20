import {iso,type Camera} from './gameCamera';
import {AMENITIES,type Amenity} from './officeActivities';
import {amenityDestination,studioStyle,DESK_VECTOR,type DeskFacing,type Actor,type World,type Point} from './officeSimulation';
import {OfficePixels,SPRITE} from './officePixels';
import {BALL_COLORS,simulateShot,type Recreation,type Ball} from '@/lib/office/recreation';

export type Selection={kind:'company'|'person'|'amenity';id:string};
export type Hit={target:Selection;x:number;y:number;w:number;h:number};
type Prop={x:number;y:number;radius:number;depth:number;paint:()=>void;dynamic?:boolean};
const C={edge:'#263d39',wood:'#bb8c57',woodSide:'#7b593c',woodDark:'#604b37',metal:'#344d4c',screen:'#172b31',cream:'#e7dfc4',green:'#709989'};

/** A single material/perspective system, rather than independently angled furniture images. */
export class OfficeGameRenderer {
 private ctx!:CanvasRenderingContext2D;
 private props:Prop[]=[];
 private hits:Hit[]=[];
 private pixels:OfficePixels;
 private recreation:Recreation|undefined;
 private shotAt=0;
 private shotFrames:Ball[][]=[];
 private images=new Map<string,HTMLImageElement>();
 private world:World|null=null;
 private floorCache:HTMLCanvasElement|null=null;
 private floorKey='';
 constructor(private invalidate:()=>void=()=>{}){this.pixels=new OfficePixels(()=>{this.floorKey='';this.clearArt();this.invalidate();});}
 private sprite(id:number,x:number,y:number,w:number,h=w,tint?:string){const p=this.point(x,y);return this.pixels.furniture(this.ctx,id,p.x,p.y,w,h,tint);}
 private actors:Actor[]=[];
 private time=0;
 private motion=true;
 private selected:Selection|null=null;
 private camera:Camera={x:0,y:0,zoom:1};
 private width=0;private height=0;
 private point(x:number,y:number,z=0){return iso({x,y},z,Boolean(this.camera.portrait));}
 private polygon(points:Point[],fill:string,stroke=C.edge){const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.8;c.stroke();}}
 private plane(x:number,y:number,w:number,h:number,z:number,color:string,stroke=C.edge){this.polygon([this.point(x,y,z),this.point(x+w,y,z),this.point(x+w,y+h,z),this.point(x,y+h,z)],color,stroke);}
 private box(x:number,y:number,w:number,h:number,z:number,tall:number,top:string,left=C.woodSide,right=C.woodDark){
  const p=(a:number,b:number,c:number)=>this.point(a,b,c);
  this.polygon([p(x,y+h,z),p(x+w,y+h,z),p(x+w,y+h,z+tall),p(x,y+h,z+tall)],left);
  this.polygon([p(x+w,y,z),p(x+w,y+h,z),p(x+w,y+h,z+tall),p(x+w,y,z+tall)],right);
  this.plane(x,y,w,h,z+tall,top);
 }
 private line(a:Point,b:Point,color:string,width=1){const c=this.ctx;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
 private dot(x:number,y:number,z:number,r:number,color:string){const p=this.point(x,y,z),c=this.ctx;c.beginPath();c.ellipse(p.x,p.y,r,r*.75,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
 private shadow(x:number,y:number,w:number,h:number){this.plane(x+8,y+9,w,h,1,'#152b2820','');}
 private label(x:number,y:number,z:number,text:string,color='#d9e9df',background='#1b3533',size=12,legible=false){
  const p=this.point(x,y,z),c=this.ctx;if(legible)size=Math.max(size,Math.min(80,10/this.camera.zoom));c.font=`600 ${size}px "Segoe UI", sans-serif`;
  const width=c.measureText(text).width+18;c.fillStyle=background;c.fillRect(p.x-width/2,p.y-size-4,width,size+10);c.fillStyle=color;c.textAlign='center';c.fillText(text,p.x,p.y);return {x:p.x-width/2,y:p.y-size-4,w:width,h:size+10};
 }
 private hit(target:Selection,x:number,y:number,z:number,w:number,h:number){const p=this.point(x,y,z);this.hits.push({target,x:p.x-w/2,y:p.y-h,w,h});}
 private prop(x:number,y:number,paint:()=>void,radius=180,depth=x+y,dynamic=false){this.props.push({x,y,paint,radius,depth,dynamic});}
 private clearArt(){this.floorKey='';}
 private plant(x:number,y:number){if(this.sprite(SPRITE.plant,x,y+10,65,78))return;this.box(x-8,y-8,16,16,0,18,'#c4a478','#927450','#715d40');for(let i=0;i<7;i++){const a=i*2.4;this.line(this.point(x,y,17),this.point(x+Math.cos(a)*16,y+Math.sin(a)*12,38+i%3*5),'#41644a',3);this.dot(x+Math.cos(a)*16,y+Math.sin(a)*12,38+i%3*5,9,i%2?'#82a96a':'#5d865a');}}
 private chair(x:number,y:number,rear=true,facing?:DeskFacing,tint='#668398'){if(facing&&this.camera.portrait)facing=({north:'west',west:'north',south:'east',east:'south'} as const)[facing];if(this.sprite(SPRITE[({north:'chairNorth',south:'chairSouth',east:'chairEast',west:'chairWest'} as const)[facing??(rear?'north':'south')]],x,y+5,48,61,tint))return;this.box(x-12,y-10,24,20,23,5,'#51746a','#304f49','#28423d');}
 private desk(x:number,y:number,working=false){
  this.shadow(x-49,y-65,104,80);
  for(const [dx,dy] of [[-45,-61],[35,-61],[-45,-26],[35,-26]])this.box(x+dx,y+dy,5,5,0,39,'#9d8060','#5d4f3e','#4a4337');
  this.box(x-49,y-65,98,48,39,5,'#c99f69','#8b6745','#735438');
  this.box(x+29,y-59,15,32,4,32,'#a77e52','#805c3e','#634a35');
  this.box(x-14,y-59,30,5,48,27,'#364c4a','#172b2b','#233837');
  this.box(x-3,y-56,6,9,44,7,'#3b4b45');
  this.plane(x-12,y-52,26,2,72,working?'#8acdb7':'#3c6963');
  for(let i=0;i<3;i++)this.line(this.point(x-10,y-53,67-i*5),this.point(x+8-i*3,y-53,67-i*5),working?'#a1dfbe':'#4d8379',1.5);
  this.plane(x-13,y-37,30,10,45,'#344c49');for(let i=0;i<5;i++)this.line(this.point(x-10+i*5,y-36,45.5),this.point(x-10+i*5,y-29,45.5),'#9baea0');
  this.dot(x+24,y-31,46,4,'#d0d5ba');this.plane(x-40,y-41,14,18,45,'#ece4c9');
  this.box(x-35,y-57,7,7,44,9,'#e4cf9d','#b2996d','#8c7655');
  this.line(this.point(x+36,y-53,44),this.point(x+36,y-53,70),'#596d56',2);this.box(x+29,y-60,14,10,69,4,'#d7cba1','#839075','#556a54');
  this.dot(x+36,y-52,45,13,'#e4d29722');
 }
 private shelf(x:number,y:number){
  if(this.sprite(SPRITE.books,x+36,y+25,89,110))return;
  this.box(x,y,72,18,0,72,'#c3a06e','#8b7351','#67563f');
  for(let row=0;row<3;row++)for(let i=0;i<8;i++)this.box(x+4+i*8,y+18,5,4,8+row*22,12+i%3*2,['#5e8b7e','#c4a363','#c8c8a9','#8fada6'][i%4]);
 }
 private display(x:number,y:number,kind:string,trim:string){
  const sprite=kind==='controller'||kind==='trophy'?SPRITE.gaming:kind==='arcade'?SPRITE.arcade:kind==='house'||kind==='tools'?SPRITE.house:kind==='camera'||kind==='palette'?SPRITE.creative:kind==='mail'||kind==='safe'?SPRITE.printer:kind==='books'||kind==='globe'?SPRITE.books:kind==='laptop'?SPRITE.deskSouth:kind==='chart'?SPRITE.board:kind==='plant'?SPRITE.flowers:null;
  if(sprite!==null&&this.sprite(sprite,x,y+15,95,105))return;
  this.shadow(x-34,y-20,70,36);this.box(x-34,y-20,70,36,0,26,trim,'#7d785c','#5e644d');
  if(kind==='controller'||kind==='arcade'){
   this.box(x-20,y-16,37,24,26,46,'#507b66','#31584c','#23473e');this.box(x-15,y+9,27,2,47,22,'#b0d0ac','#203c37','#203c37');
   this.dot(x-6,y+13,40,4,'#d9c995');this.dot(x+8,y+13,40,3,'#b1caaa');
  }else if(kind==='trophy'){
   this.box(x-12,y-8,24,20,26,5,'#4f6854');this.box(x-3,y-1,6,6,31,14,'#c3a356');this.box(x-11,y-8,22,16,45,12,'#e3ca7d','#b59c5d','#917b47');this.dot(x,y,59,9,'#e5d39a');
  }else if(kind==='house'){
   this.box(x-20,y-12,40,28,26,23,'#e0d4ad','#b5ab87','#968d70');this.polygon([this.point(x-25,y-15,49),this.point(x,y-15,70),this.point(x+25,y-15,49)],'#75937b');this.plane(x-25,y-15,50,34,49,'#708772');this.box(x-4,y+17,8,2,26,16,'#456d5f');
  }else if(kind==='camera'){
   this.box(x-18,y-7,32,20,30,21,'#657c70','#344e46','#263c35');this.dot(x,y+15,40,10,'#c4cbb2');this.dot(x,y+15,40,6,'#244239');this.line(this.point(x,y,30),this.point(x-18,y+10,26),'#3d5348',3);
  }else if(kind==='mail'){
   this.box(x-23,y-8,46,5,26,32,'#dbd6b8','#e6debd','#afa486');this.line(this.point(x-20,y-1,54),this.point(x,y-1,39),'#789581',2);this.line(this.point(x,y-1,39),this.point(x+20,y-1,54),'#789581',2);
  }else if(kind==='globe'){
   this.dot(x,y,49,20,'#7baba0');this.line(this.point(x-12,y,49),this.point(x+12,y,49),'#b7cda0',4);this.box(x-3,y-3,6,6,26,13,'#a18f69');
  }else if(kind==='safe'){
   this.box(x-18,y-10,36,28,26,32,'#92a89b','#657e70','#49675a');this.dot(x,y+20,42,7,'#c9cfb4');
  }else if(kind==='laptop'||kind==='chart'){
   this.box(x-22,y-12,44,5,26,28,'#49675b','#244139','#304d43');this.box(x-18,y-6,36,1,30,20,'#98bcaa','#7fab93','#7fab93');this.plane(x-22,y-5,44,22,27,'#849a84');
  }else if(kind==='palette'){
   this.plane(x-25,y-12,50,28,27,'#d9ceb0');for(let i=0;i<5;i++)this.dot(x-17+i*8,y+2,29,4,['#537d69','#cfb378','#8eac98','#dcceaa','#3c6356'][i]);
  }else if(kind==='tools'){
   this.box(x-22,y-12,44,28,26,16,'#9baa7f','#718659','#566b42');this.line(this.point(x-12,y,47),this.point(x+10,y,47),'#e1d3ad',4);
  }else for(let i=0;i<4;i++)this.box(x-20+i*11,y-8,8,20,26,19+i%2*8,['#567e6b','#c6b488','#8ea694','#cecfad'][i]);
 }
 private wall(x:number,y:number,w:number,h:number,color='#d6cdbc'){this.box(x,y,w,h,0,90,'#e3dbcb',color,'#96948b');this.box(x,y,w,h,88,4,'#d8d9bd','#c1caae','#a9bca5');}
 private window(x:number,y:number,side=false){
  // Glazing on the rear wall, with consistently projected mullions.
  const p=(along:number,z:number)=>this.point(x+(side?0:along),y+(side?along:0),z);
  const a=p(0,25),b=p(115,25),d=p(0,80),e=p(115,80);
  this.polygon([a,b,e,d],'#92bcb4','#415e55');
  for(let i=1;i<4;i++)this.line(p(i*28.75,25),p(i*28.75,80),'#dfdfc6',3);
  this.line(p(0,51),p(115,51),'#dfdfc6',3);
  this.plane(x-4,y,side?10:123,side?123:10,23,'#c5cbb0');
 }
 private wallArt(x:number,y:number,kind='chart'){
  if(kind==='poster'&&this.sprite(SPRITE.board,x+28,y,78,64))return;
  this.box(x,y,56,3,26,46,'#d1b88b','#b29b73','#8f7959');
  this.box(x+4,y+4,48,1,30,38,'#f0e5c9','#ece1bd','#ece1bd');
  if(kind==='chart'){for(let i=0;i<4;i++)this.box(x+9+i*10,y+6,6,1,35,8+i%3*7,'#6c9d7b','#6c9d7b','#6c9d7b');}
  else {this.dot(x+26,y+8,48,10,'#729c89');this.line(this.point(x+10,y+7,37),this.point(x+43,y+7,37),'#b69d70',2);}
 }
 private logo(url:string|undefined,x:number,y:number){if(!url)return;let image=this.images.get(url);if(!image){image=new Image();image.onload=()=>{this.clearArt();this.invalidate();};image.src=url;this.images.set(url,image);}if(image.complete&&image.naturalWidth){const p=this.point(x,y,92),c=this.ctx;c.fillStyle='#f4f0df';c.fillRect(p.x-15,p.y-16,30,30);const k=Math.min(26/image.width,26/image.height);c.drawImage(image,p.x-image.width*k/2,p.y-1-image.height*k/2,image.width*k,image.height*k);}}
 private occupants(id:Amenity){return this.actors.filter(a=>a.arrived&&a.destination.amenity===id);}
 private furniture(id:Amenity){
  if(this.pixels.ready){
   if(id==='pool'){
    this.sprite(SPRITE.pool,770,405,200,150);
    const shot=this.recreation?.pool.lastShot;
    if(shot&&shot.at!==this.shotAt){this.shotAt=shot.at;this.shotFrames=simulateShot(shot.balls,shot.angle,shot.power).frames;}
    const elapsed=shot?Math.max(0,this.time-shot.at/1000):0;
    const balls=shot&&elapsed<shot.duration&&this.motion?this.shotFrames[Math.min(this.shotFrames.length-1,Math.floor(elapsed*30))]:this.recreation?.pool.balls;
    const q=this.point(770,405);
    for(const b of balls??[]){if(b.pocketed)continue;const bx=q.x-78+b.x/320*156,by=q.y-105+b.y/160*47;this.ctx.fillStyle='#20382b';this.ctx.fillRect(Math.round(bx-3),Math.round(by-3),7,6);this.ctx.fillStyle=BALL_COLORS[b.id];this.ctx.fillRect(Math.round(bx-2),Math.round(by-3),5,4);this.ctx.fillStyle='#fff5d8';this.ctx.fillRect(Math.round(bx-1),Math.round(by-3),1,1);}
    for(const [slot,a] of this.occupants('pool').entries()){const p=this.point(a.point.x,a.point.y,30);this.line(p,{x:q.x+(slot?-55:55),y:q.y-77},'#ddc18a',2);}
    return;
   }
   if(id==='gaming'){
    this.sprite(SPRITE.tv,1100,270,170,145);const q=this.point(1100,270),tv=this.recreation?.tv;
    this.ctx.fillStyle=tv?.on?'#102d31':'#111a1b';this.ctx.fillRect(q.x-59,q.y-106,121,52);
    if(tv?.on)for(let i=0;i<12;i++){const visible=tv.matched.includes(i)||(tv.open.includes(i)&&(tv.open.length<2||this.time*1000<tv.revealUntil));this.ctx.fillStyle=visible?BALL_COLORS[tv.cards[i]+1]:'#42665b';this.ctx.fillRect(q.x-44+i%4*24,q.y-101+Math.floor(i/4)*15,18,11);}return;
   }
   if(id==='coffee'){this.sprite(SPRITE.coffee,755,178,160,135);if(this.motion&&(this.occupants('coffee').length||this.time*1000-(this.recreation?.objects.coffee??0)<12000)){const p=this.point(730,148,70);for(let i=0;i<3;i++){this.ctx.fillStyle='#e3e6c999';this.ctx.fillRect(Math.round(p.x+i*5),Math.round(p.y-((this.time*8+i*9)%24)),2,5);}}return;}
   if(id==='water'){this.sprite(SPRITE.water,930,185,58,90);if(this.motion&&this.time*1000-(this.recreation?.objects.water??0)<6000){const q=this.point(930,185);this.ctx.fillStyle='#9ad9f3';this.ctx.fillRect(q.x-2,q.y-39,2,10);this.ctx.fillStyle='#d5eced';this.ctx.fillRect(q.x-5,q.y-29,8,8);}return;}
   if(id==='plant'){this.plant(1200,140);if(this.motion&&this.time*1000-(this.recreation?.objects.plant??0)<6000){const q=this.point(1200,140);for(let i=0;i<4;i++){this.ctx.fillStyle='#93cfe2';this.ctx.fillRect(q.x-20+i*10,q.y-50+(this.time*18+i*7)%35,2,4);}}return;}
   if(id==='couch'){this.sprite(SPRITE.sofa,1100,475,190,100,'#b77e57');return;}
   if(id==='conference'){this.sprite(SPRITE.conference,285,385,245,130);return;}
  }
  if(id==='conference'){
   this.shadow(175,305,235,70);
   this.box(180,310,225,50,0,43,'#b9986b');this.box(175,305,235,60,43,6,'#d5b987');
   for(let i=0;i<4;i++){this.plane(190+i*47,320,22,20,50,'#e7e2cd');this.box(214+i*47,335,5,5,50,7,'#93aead');}
  } else if(id==='projector'){
   this.box(190,125,190,9,0,100,'#cfd9c7','#c9d6c4','#768e85');this.box(199,135,172,2,25,65,'#aac7bb','#244d48','#294f49');
   const slide=this.recreation?.projectorSlide??0,people=this.world?.people??[],n=slide===0?people.filter(p=>p.desk.state==='working').length:slide===1?this.world?.suites.filter(s=>s.room.kind!=='management').length??0:people.filter(p=>p.desk.human).length;
   this.label(285,138,72,['WORKING NOW','COMPANY STUDIOS','HUMAN TEAM'][slide],'#e6e5cd','#244d48',10);
   this.label(285,138,43,String(n),'#f0dc9e','#244d48',22);
  } else if(id==='pool'){
   this.shadow(695,280,150,110);
   this.box(700,285,140,100,0,44,'#604d3a');this.box(695,280,150,110,44,7,'#aa8050');this.plane(707,292,126,86,52,'#356e59');
   for(const x of [708,770,832])for(const y of [292,377])this.dot(x,y,53,4,'#182e29');
   const active=this.occupants('pool').length>=2,t=active&&this.motion?(this.time%5)/5:0;
   for(let i=0;i<7;i++)this.dot(735+i%3*17+(i===0?Math.sin(t*Math.PI)*50:0),315+Math.floor(i/3)*16,54,3.6,['#f2e6c6','#cf9858','#537c8c','#a35748'][i%4]);
   if(active)for(const [slot,a] of this.occupants('pool').entries()){const p=a.point,tip={x:slot%2?805:730,y:345};this.line(this.point(p.x,p.y,52),this.point(tip.x,tip.y,53),'#dec596',2);}
  } else if(id==='gaming'){
   this.box(1030,205,145,28,0,27,'#657768');this.box(1045,215,115,6,28,64,'#334d4a','#142c30','#203c3c');
   this.box(1050,223,105,2,34,50,'#92bba0','#37675e','#437e67');this.box(1150,229,17,12,27,7,'#c5c8b3');
   const t=this.motion&&this.occupants('gaming').length?Math.sin(this.time)*12:0;this.dot(1080+t,226,57,5,'#c9de9c');this.dot(1120-t,226,48,5,'#d6b77c');
  } else if(id==='couch'){
   // Seat centers use exactly the same slots as the server; no sitting on the TV stand.
   for(let i=0;i<3;i++){const p=amenityDestination('couch',i).point;this.box(p.x-21,p.y-15,42,32,0,22,'#527e70');this.box(p.x-22,p.y+13,44,8,22,30,'#80a68c','#547764','#385b4f');this.box(p.x-19,p.y-12,38,25,22,6,'#9ab495','#75977c','#507c65');}
  } else if(id==='coffee'){
   this.box(690,130,140,40,0,50,'#c0a77b','#7c8f79','#4c6e5d');this.box(710,140,33,24,50,29,'#455955','#223b36','#29423a');this.dot(725,164,63,4,'#c2d5c0');
   for(let i=0;i<4;i++)this.box(758+i*13,142,7,7,51,8,'#eee3c5');
   this.box(790,143,22,18,51,12,'#9b8060');this.dot(800,153,65,8,'#d5b26e');
   if(this.occupants('coffee').length&&this.motion)this.label(735,150,94,'≈','#c2d6bd','#0000',22);
  } else if(id==='water'){
   this.box(915,155,30,28,0,45,'#d6d9c3','#afc4b6','#809b91');this.box(920,159,20,20,45,26,'#b5d9d4','#73a9ae','#579392');this.dot(932,184,30,3,'#477e90');
  } else if(id==='plant')this.plant(1200,140);
  else {if(this.motion&&this.time*1000-(this.recreation?.objects.reception??0)<4000)this.label(510,555,78,'Ding!','#e5d6a0','#353c3e',12);this.box(420,530,125,40,0,45,'#c2a075');this.box(420,530,125,8,45,10,'#dac19a');this.box(463,549,30,5,45,23,'#405750');}
 }
 private prepare(world:World){
  this.world=world;this.props=[];this.floorKey='';this.clearArt();
  this.prop(20,20,()=>this.wall(12,12,world.width-24,9),1100,0);
  this.prop(20,20,()=>this.wall(12,12,9,world.height-24),world.height,0);
  for(let y=85;y<world.height-80;y+=240)this.prop(25,y,()=>{this.window(25,y,true);},200,25+y);
  for(const x of [180,450,730,1040])this.prop(x,24,()=>{this.window(x,24);},200);
  this.prop(580,35,()=>{this.wallArt(580,35);this.plant(590,90);},180);
  this.prop(880,35,()=>{this.wallArt(880,35,'poster');this.shelf(890,45);},200);
  this.prop(640,140,()=>{this.box(625,50,10,400,0,25,'#c8cfb4','#8a9f86','#68866e');this.plant(630,80);this.plant(630,430);},450);
  this.prop(1150,550,()=>{this.box(1080,560,120,30,0,23,'#a4b799');this.box(1080,585,120,5,23,22,'#7d9a80');this.plant(1230,565);},220);
  this.prop(100,80,()=>this.label(260,80,110,'THE MEETING ROOM'),200);
  this.prop(750,70,()=>this.label(980,65,100,'THE COMMONS'),200);
  this.prop(70,565,()=>{this.plant(45,580);this.shelf(145,540);this.label(255,575,7,'NUCLEAS  /  HEADQUARTERS','#496b59','#d6c7a2',16);},250);
  for(const id of Object.keys(AMENITIES) as Amenity[]){const p=id==='couch'?{x:1100,y:425}:id==='conference'?{x:290,y:350}:id==='pool'?{x:770,y:335}:id==='gaming'?{x:1100,y:230}:id==='coffee'?{x:755,y:150}:id==='water'?{x:930,y:170}:id==='plant'?{x:1200,y:140}:{x:285,y:140};if(id==='reception'){p.x=480;p.y=550;}
   this.prop(p.x,p.y,()=>{this.furniture(id);this.hit({kind:'amenity',id},p.x,p.y,20,id==='conference'?210:id==='pool'?190:id==='gaming'?145:100,100);},240,p.x+p.y,['pool','gaming','coffee','water','plant','projector','reception'].includes(id));
  }
  for(let i=0;i<6;i++){const p=amenityDestination('conference',i).point;this.prop(p.x,p.y,()=>this.chair(p.x,p.y,i>=3,i<3?'south':'north'),90,p.x+p.y+(i<3?-5:6),true);}
  if(world.width>1700){this.prop(1400,240,()=>{this.shelf(1320,48);this.shelf(1410,48);this.box(1340,220,115,44,0,24,'#78987b');this.box(1340,258,115,8,24,29,'#a7b697');this.box(1355,160,78,35,0,25,'#c9b381');this.plant(1490,160);this.plant(1320,390);this.wallArt(1445,35,'poster');},300);}
  this.prop(132,420,()=>{this.sprite(SPRITE.coat,132,420,43,80);this.sprite(SPRITE.printer,140,220,64,80);},110);
  for(const suite of world.suites){const {x,y,w,h,room}=suite;const style=studioStyle(room);
   this.prop(x,y,()=>{this.wall(x,y,w,8,style.wall);this.box(x,y+8,w,2,0,20,style.accent,style.accent,style.accent);this.window(x+30,y+9);this.logo(room.logo,x+w*.52,y+20);},w,x+y);
   this.prop(x,y,()=>{if(room.relationship==='client'){const door=suite.door.y-y;this.wall(x,y,8,door-35);this.wall(x,y+door+35,8,h-door-35);}else this.box(x,y,8,h-40,0,this.camera.portrait?28:90,'#bfc7ad','#8eaa98','#6d8d7c');},h,x+y);
   this.prop(x+w-12,y+h/2,()=>{if(room.relationship!=='client'){const door=suite.door.y-y;this.box(x+w-8,y+8,8,door-40,0,20,'#becaaa','#81997b','#668469');} },h);
   this.prop(x+180,y+12,()=>{this.wallArt(x+155+style.seed%30,y+12,style.seed%2?'poster':'chart');if(style.seed%3)this.wallArt(x+245,y+12,'poster');else this.shelf(x+245,y+15);},200);
   this.prop(x+w-65,y+65,()=>{this.plant(x+w-45,y+50);this.shelf(x+w-160,y+15);},220);
   this.prop(x+w*.5,y+h-15,()=>{this.label(x+w*.5,y+h-15,0,room.kind==='management'?'THE HUMAN TEAM':room.relationship==='client'?'CLIENT STUDIO':style.theme.label.toUpperCase(),'#f1e9d7','#3d4546',11);},200);
   // Product displays, personal clutter and smaller reading nooks replace empty desk grids.
   const compact=room.relationship==='client',corners=style.seed%2===0;
   const positions=compact?[{x:x+w-105,y:y+h-90}]:[{x:x+90,y:y+h-85},{x:x+(corners?290:470),y:y+h-100}];
   if(room.kind!=='management')positions.forEach((p,i)=>this.prop(p.x,p.y,()=>this.display(p.x,p.y,style.theme.objects[(i+style.seed)%style.theme.objects.length],style.trim),100));
   if(!compact&&room.desks.length<4){
    const nx=x+(corners?485:275),ny=y+h-100;
    this.prop(nx,ny,()=>{this.sprite(SPRITE.sofa,nx,ny+18,120,75,style.accent);this.box(nx-28,ny-75,56,30,0,21,'#bd9c70','#8d7050','#69513c');this.plane(nx-15,ny-66,18,14,22,'#eee1c5');this.sprite(SPRITE.flowers,nx+70,ny+15,48,57);},160);
   }
   if(!room.desks.length)this.prop(x+w*.48,y+205,()=>{this.box(x+w*.48-65,y+190,130,65,0,35,style.trim);this.chair(x+w*.48-30,y+275);this.chair(x+w*.48+30,y+275);this.display(x+w*.48,y+165,style.theme.objects[0],style.trim);},200);
   for(let i=0;i<2;i++){const px=x+35+(style.seed%3)*12+i*(w-110);this.prop(px,y+80,()=>this.plant(px,y+80),90);}

  }
  for(const person of world.people){
   const {x,y}=person.home.point,facing=person.home.facing??'north',v=DESK_VECTOR[facing],client=person.room.relationship==='client',distance=client?42:56,center={x:x+v.x*distance,y:y+v.y*distance};
   const deskSprite=()=>{const displayFacing=this.camera.portrait?({north:'west',west:'north',south:'east',east:'south'} as const)[facing]:facing;
   return SPRITE[({north:'deskNorth',east:'deskEast',south:'deskSouth',west:'deskWest'} as const)[displayFacing]];};
   this.prop(center.x,center.y,()=>{if(!this.sprite(deskSprite(),center.x,center.y+22,client?(facing==='north'||facing==='south'?86:65):(facing==='north'||facing==='south'?130:96),client?85:100))this.desk(x,y,person.desk.state==='working');this.hit({kind:'person',id:person.id},center.x,center.y+12,0,client?90:130,100);},150,center.x+center.y+22,true);
   this.prop(x,y,()=>this.chair(x,y,facing==='north',facing,studioStyle(person.room).accent),90,x+y+(facing==='north'?6:-5),true);
  }
 }
 private floor(world:World){
  this.box(10,10,world.width-20,world.height-20,-14,14,'#b2a07b','#746853','#60594a');
  const bounds=[{x:20,y:20,w:590,h:480,color:'#b0aba0'},{x:640,y:20,w:620,h:480,color:'#bea487'},...world.suites.map(s=>({x:s.x,y:s.y,w:s.w,h:s.h,color:studioStyle(s.room).floor}))];
  for(const r of bounds)this.plane(r.x,r.y,r.w,r.h,.5,r.color,'#6b806c');
  for(const suite of world.suites)this.plane(suite.x+12,suite.y+12,suite.w-24,10,1,suite.room.color,'');
  this.plane(150,250,300,190,1,'#728596','#c6cfcb');this.plane(680,260,175,150,1,'#7d8e69','#afbc8e');this.plane(1000,300,190,180,1,'#a77256','#d6bc93');
  for(let y=24,row=0;y<world.height-24;y+=24,row++)for(let x=24-(row%2)*64;x<world.width-24;x+=128){
   const xx=Math.max(24,x),ww=Math.min(128,world.width-24-xx);if(ww<=0||!this.visible(this.point(xx,y),150))continue;
   this.line(this.point(xx,y),this.point(xx+ww,y),'#eadbb326',1);
   this.line(this.point(xx,y),this.point(xx,y+24),'#4b50352b',1);
   if((row+Math.floor(x/128))%3===0)this.line(this.point(xx+6,y+7),this.point(xx+ww-9,y+7),'#324a3020',1);
  }
  for(const p of world.people){const {x,y}=p.home.point;this.plane(x-57,y-72,114,105,1,studioStyle(p.room).rug,studioStyle(p.room).trim);}
  for(let x=20;x<world.width;x+=65)for(let y=20;y<world.height;y+=65){const p=this.point(x,y);if(!this.visible(p,90))continue;this.line(p,this.point(Math.min(x+65,world.width-20),y),'#213a2d12');this.line(p,this.point(x,Math.min(y+65,world.height-20)),'#213a2d12');}
  for(const s of world.suites){const style=studioStyle(s.room);
   // Floor inlays and offset rugs make the suites feel inhabited without adding geometry or textures.
   this.plane(s.x+22,s.y+105,s.w-55,style.seed%2?240:110,1.2,style.rug,style.trim);
   for(let k=0;k<4;k++)this.plane(s.x+28,s.y+110+k*7,42,2,1.3,style.trim,'');
   this.plane(s.door.x-12,s.door.y-22,24,44,1.5,style.trim,'');
  }
 }
 private visible(p:Point,r:number){const c=this.camera;return p.x*c.zoom+c.x>-r*c.zoom&&p.x*c.zoom+c.x<this.width+r*c.zoom&&p.y*c.zoom+c.y>-r*c.zoom&&p.y*c.zoom+c.y<this.height+r*c.zoom;}
 paint(ctx:CanvasRenderingContext2D,world:World,actors:Actor[],time:number,camera:Camera,width:number,height:number,selected:Selection|null,motion:boolean,recreation?:Recreation){
  this.ctx=ctx;this.recreation=recreation;this.time=time;this.actors=actors;this.motion=motion;this.camera=camera;this.width=width;this.height=height;this.selected=selected;this.hits=[];
  if(world!==this.world){this.prepare(world);const urls=new Set(world.suites.map(s=>s.room.logo));for(const url of this.images.keys())if(!urls.has(url))this.images.delete(url);}
  // Cache the entire visible floor. Its grid and material details never repaint during actor motion.
  const floorKey=[width,height,camera.x,camera.y,camera.zoom,camera.portrait].join(':');
  if(!this.floorCache)this.floorCache=document.createElement('canvas');
  if(this.floorKey!==floorKey){const layer=this.floorCache;layer.width=width;layer.height=height;const base=layer.getContext('2d')!;
   this.ctx=base;base.fillStyle='#33383a';base.fillRect(0,0,width,height);base.translate(camera.x,camera.y);base.scale(camera.zoom,camera.zoom);this.floor(world);this.ctx=ctx;this.floorKey=floorKey;
  }
  const depth=(p:Prop)=>p.depth===0?0:(this.camera.portrait?p.x+p.y*.01:p.y+p.x*.01)+(p.depth-p.x-p.y);
  ctx.drawImage(this.floorCache,0,0,width,height);ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
  const people=new Map(world.people.map(p=>[p.id,p]));
  // Independent furniture and characters share one depth pass; floors and character frames are cached.
  const props=[...this.props];
  const badges:{actor:Actor;name:string;waiting:number;selected:boolean}[]=[];
  for(const actor of actors){const p=people.get(actor.id);if(!p)continue;props.push({x:actor.point.x,y:actor.point.y,radius:110,depth:actor.point.x+actor.point.y+2,paint:()=>{
   const q=this.point(actor.point.x,actor.point.y),selected=this.selected?.kind==='person'&&this.selected.id===actor.id;
   this.ctx.fillStyle=selected?'#b4e6aa88':'#16392b30';this.ctx.beginPath();this.ctx.ellipse(q.x,q.y,18,8,0,0,Math.PI*2);this.ctx.fill();
   const next=actor.route[0],direction=next?this.point(next.x-actor.point.x,next.y-actor.point.y):null;
   let facing:DeskFacing=direction?(Math.abs(direction.x)>Math.abs(direction.y)?direction.x<0?'west':'east':direction.y<0?'north':'south'):actor.destination.facing??(actor.destination.view==='rear'?'north':actor.destination.amenity==='pool'?(actor.point.x<770?'east':'west'):actor.destination.amenity==='coffee'||actor.destination.amenity==='water'?'north':'south');
   if(!direction&&this.camera.portrait&&actor.destination.facing)facing=({north:'west',west:'north',south:'east',east:'south'} as const)[facing];
   const pose=!actor.arrived?'walk':actor.destination.amenity==='gaming'?'game':actor.destination.pose==='seated'?(p.desk.state==='working'?'type':'sit'):actor.destination.pose;
   this.pixels.person(this.ctx,actor.id,q.x,q.y,facing,pose,motion?time:0);
   this.hit({kind:'person',id:actor.id},actor.point.x,actor.point.y,0,45,78);
   badges.push({actor,name:p.desk.name,waiting:p.desk.waiting,selected});
  }});}
  props.sort((a,b)=>depth(a)-depth(b));
  for(const prop of props)if(this.visible(this.point(prop.x,prop.y),prop.radius))prop.paint();
  for(const suite of world.suites){
   const lx=camera.portrait?suite.x+30:suite.x+suite.w*.5,ly=camera.portrait?suite.y+suite.h*.5:suite.y+25,lz=camera.portrait?10:105;
   const p=this.point(lx,ly,lz);if(!this.visible(p,220))continue;
   const room=suite.room,status=room.kind==='management'?room.desks.length+(room.desks.length===1?' person':' people'):room.waiting?room.waiting+' need you':room.working?room.working+' working':room.desks.length+(room.desks.length===1?' employee':' employees');
   const box=this.label(lx,ly,lz,camera.zoom<.35?room.name:`${room.name}  ·  ${status}`,room.waiting?'#f4d294':'#daeadb','#1b3533',12,true);this.hits.push({target:{kind:'company',id:room.companyId},...box});
  }

  const occupied=this.hits.filter(h=>h.target.kind==='company');
  for(const badge of badges){
   const a=badge.actor,full=badge.selected||camera.zoom>.85,short=badge.name.split(' ')[0],name=(full?badge.name:short)+(badge.waiting?' · '+badge.waiting:'');
   const head=a.arrived&&a.destination.pose==='seated'?78:92;
   let z=head,rect:{x:number;y:number;w:number;h:number}|undefined;
   for(let attempt=0;attempt<5;attempt++){
    const p=this.point(a.point.x,a.point.y,z),font=Math.max(10,Math.min(80,10/camera.zoom));this.ctx.font=`600 ${font}px "Segoe UI",sans-serif`;const w=this.ctx.measureText(name).width+18;
    rect={x:p.x-w/2,y:p.y-font-4,w,h:font+10};
    if(!occupied.some(r=>rect!.x<r.x+r.w&&rect!.x+rect!.w>r.x&&rect!.y<r.y+r.h&&rect!.y+rect!.h>r.y))break;
    z+=15/camera.zoom;
   }
   const box=this.label(a.point.x,a.point.y,z,name,badge.waiting?'#ffe0a1':'#f0eee3','#273a3be8',10,true);
   occupied.push({target:{kind:'person',id:a.id},...box});this.hits.push({target:{kind:'person',id:a.id},...box});
   if(z>head)this.line(this.point(a.point.x,a.point.y,head-5),this.point(a.point.x,a.point.y,z-4),'#e6e0c980',.8);
  }
  ctx.restore();return this.hits;
 }
 dispose(){this.pixels.dispose();this.shotFrames=[];this.clearArt();if(this.floorCache){this.floorCache.width=0;this.floorCache.height=0;}this.floorCache=null;for(const image of this.images.values())image.onload=null;this.images.clear();this.props=[];this.world=null;}
}
