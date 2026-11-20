import {iso,type Camera} from './gameCamera';
import {AMENITIES,type Amenity} from './officeActivities';
import {amenityDestination,studioStyle,type Actor,type World,type Point} from './officeSimulation';
import {drawOfficeRig} from './officeRig';
import {releaseOfficeAppearances} from './officeAppearance';
import {employeeAppearance} from '@/lib/companies/employeeIdentity';

export type Selection={kind:'company'|'person'|'amenity';id:string};
export type Hit={target:Selection;x:number;y:number;w:number;h:number};
type Prop={x:number;y:number;radius:number;depth:number;paint:()=>void;dynamic?:boolean};
const C={edge:'#263d39',wood:'#bb8c57',woodSide:'#7b593c',woodDark:'#604b37',metal:'#344d4c',screen:'#172b31',cream:'#e7dfc4',green:'#709989'};

/** A single material/perspective system, rather than independently angled furniture images. */
export class OfficeGameRenderer {
 private ctx!:CanvasRenderingContext2D;
 private props:Prop[]=[];
 private hits:Hit[]=[];
 private rigs=new Map<string,HTMLCanvasElement>();
 private images=new Map<string,HTMLImageElement>();
 private world:World|null=null;
 private floorCache:HTMLCanvasElement|null=null;
 private floorKey='';
 private backdrop:HTMLCanvasElement|null=null;
 private backdropKey='';
 private backdropHits:Hit[]=[];
 constructor(private invalidate:()=>void=()=>{}){}
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
 private clearArt(){this.backdropKey='';this.backdropHits=[];}
 private plant(x:number,y:number){this.box(x-8,y-8,16,16,0,18,'#c4a478','#927450','#715d40');for(let i=0;i<7;i++){const a=i*2.4;this.line(this.point(x,y,17),this.point(x+Math.cos(a)*16,y+Math.sin(a)*12,38+i%3*5),'#41644a',3);this.dot(x+Math.cos(a)*16,y+Math.sin(a)*12,38+i%3*5,9,i%2?'#82a96a':'#5d865a');}}
 private chair(x:number,y:number,rear=true){this.box(x-12,y-10,24,20,23,5,'#51746a','#304f49','#28423d');this.box(x-12,y+(rear?7:-15),24,5,28,28,'#75958a','#45675b','#35574d');this.box(x-2,y-1,4,4,0,23,'#60736c','#34453e','#263b34');this.line(this.point(x-14,y,1),this.point(x+14,y,1),'#263d39',3);this.line(this.point(x,y-12,1),this.point(x,y+12,1),'#263d39',3);}
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
  this.box(x,y,72,18,0,72,'#c3a06e','#8b7351','#67563f');
  for(let row=0;row<3;row++)for(let i=0;i<8;i++)this.box(x+4+i*8,y+18,5,4,8+row*22,12+i%3*2,['#5e8b7e','#c4a363','#c8c8a9','#8fada6'][i%4]);
 }
 private display(x:number,y:number,kind:string,trim:string){
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
 private wall(x:number,y:number,w:number,h:number){this.box(x,y,w,h,0,90,'#bfc7ad','#8eaa98','#6d8d7c');this.box(x,y,w,h,88,4,'#d8d9bd','#c1caae','#a9bca5');}
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
  this.box(x,y,56,3,26,46,'#d1b88b','#b29b73','#8f7959');
  this.box(x+4,y+4,48,1,30,38,'#f0e5c9','#ece1bd','#ece1bd');
  if(kind==='chart'){for(let i=0;i<4;i++)this.box(x+9+i*10,y+6,6,1,35,8+i%3*7,'#6c9d7b','#6c9d7b','#6c9d7b');}
  else {this.dot(x+26,y+8,48,10,'#729c89');this.line(this.point(x+10,y+7,37),this.point(x+43,y+7,37),'#b69d70',2);}
 }
 private logo(url:string|undefined,x:number,y:number){if(!url)return;let image=this.images.get(url);if(!image){image=new Image();image.onload=()=>{this.clearArt();this.invalidate();};image.src=url;this.images.set(url,image);}if(image.complete&&image.naturalWidth){const p=this.point(x,y,92),c=this.ctx;c.fillStyle='#f4f0df';c.fillRect(p.x-15,p.y-16,30,30);const k=Math.min(26/image.width,26/image.height);c.drawImage(image,p.x-image.width*k/2,p.y-1-image.height*k/2,image.width*k,image.height*k);}}
 private occupants(id:Amenity){return this.actors.filter(a=>a.arrived&&a.destination.amenity===id);}
 private furniture(id:Amenity){
  if(id==='conference'){
   this.shadow(175,305,235,70);
   for(let i=0;i<6;i++){const p=amenityDestination(id,i).point;this.chair(p.x,p.y,i>=3);}
   this.box(180,310,225,50,0,43,'#b9986b');this.box(175,305,235,60,43,6,'#d5b987');
   for(let i=0;i<4;i++){this.plane(190+i*47,320,22,20,50,'#e7e2cd');this.box(214+i*47,335,5,5,50,7,'#93aead');}
  } else if(id==='projector'){
   this.box(190,125,190,9,0,100,'#cfd9c7','#c9d6c4','#768e85');this.box(199,135,172,2,25,65,'#aac7bb','#244d48','#294f49');
   for(let i=0;i<5;i++)this.box(215+i*26,138,14,2,28,16+i%3*12,'#9dcdb6','#70ad94','#70ad94');
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
  else {this.box(420,530,125,40,0,45,'#c2a075');this.box(420,530,125,8,45,10,'#dac19a');this.box(463,549,30,5,45,23,'#405750');}
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
   this.prop(p.x,p.y,()=>{this.furniture(id);this.hit({kind:'amenity',id},p.x,p.y,20,id==='conference'?210:id==='pool'?190:id==='gaming'?145:100,100);},240,p.x+p.y,['pool','gaming','coffee'].includes(id));
  }
  if(world.width>1700){this.prop(1400,240,()=>{this.shelf(1320,48);this.shelf(1410,48);this.box(1340,220,115,44,0,24,'#78987b');this.box(1340,258,115,8,24,29,'#a7b697');this.box(1355,160,78,35,0,25,'#c9b381');this.plant(1490,160);this.plant(1320,390);this.wallArt(1445,35,'poster');},300);}
  for(const suite of world.suites){const {x,y,w,h,room}=suite;const style=studioStyle(room);
   this.prop(x,y,()=>{this.wall(x,y,w,8);this.window(x+30,y+9);this.logo(room.logo,x+w*.52,y+20);},w,x+y);
   this.prop(x,y,()=>{if(room.relationship==='client'){const door=suite.door.y-y;this.wall(x,y,8,door-35);this.wall(x,y+door+35,8,h-door-35);}else this.box(x,y,8,h-40,0,this.camera.portrait?28:90,'#bfc7ad','#8eaa98','#6d8d7c');},h,x+y);
   this.prop(x+w-12,y+h/2,()=>{if(room.relationship!=='client'){const door=suite.door.y-y;this.box(x+w-8,y+8,8,door-40,0,20,'#becaaa','#81997b','#668469');} },h);
   this.prop(x+180,y+12,()=>{this.wallArt(x+155+style.seed%30,y+12,style.seed%2?'poster':'chart');if(style.seed%3)this.wallArt(x+245,y+12,'poster');else this.shelf(x+245,y+15);},200);
   this.prop(x+w-65,y+65,()=>{this.plant(x+w-45,y+50);this.shelf(x+w-160,y+15);},220);
   this.prop(x+w*.5,y+h-15,()=>{this.label(x+w*.5,y+h-15,0,room.kind==='management'?'THE HUMAN TEAM':room.relationship==='client'?'CLIENT STUDIO':style.theme.label.toUpperCase(),'#d6e2cc','#4e705f',11);},200);
   // Product displays, personal clutter and smaller reading nooks replace empty desk grids.
   const positions=room.relationship==='client'?[{x:x+85,y:y+400}]:[{x:x+100,y:y+400},{x:x+290,y:y+400},{x:x+480,y:y+400}];
   if(room.kind!=='management')positions.forEach((p,i)=>this.prop(p.x,p.y,()=>this.display(p.x,p.y,style.theme.objects[i%style.theme.objects.length],style.trim),100));
   if(!room.desks.length)this.prop(x+w*.48,y+205,()=>{this.box(x+w*.48-65,y+190,130,65,0,35,style.trim);this.chair(x+w*.48-30,y+275);this.chair(x+w*.48+30,y+275);this.display(x+w*.48,y+165,style.theme.objects[0],style.trim);},200);
   for(let i=0;i<2;i++){const px=x+35+(style.seed%3)*12+i*(w-110);this.prop(px,y+80,()=>this.plant(px,y+80),90);}

  }
  for(const person of world.people){const {x,y}=person.home.point;this.prop(x,y-40,()=>{this.desk(x,y,person.desk.state==='working');this.hit({kind:'person',id:person.id},x,y-35,35,110,65);},150,x+y-35);this.prop(x,y+9,()=>this.chair(x,y),100,x+y+9,true);}
 }
 private floor(world:World){
  this.box(10,10,world.width-20,world.height-20,-14,14,'#b2a07b','#746853','#60594a');
  const bounds=[{x:20,y:20,w:590,h:480,color:'#83988a'},{x:640,y:20,w:620,h:480,color:'#8a9c85'},...world.suites.map(s=>({x:s.x,y:s.y,w:s.w,h:s.h,color:studioStyle(s.room).floor}))];
  for(const r of bounds)this.plane(r.x,r.y,r.w,r.h,.5,r.color,'#6b806c');
  for(const suite of world.suites)this.plane(suite.x+12,suite.y+12,suite.w-24,10,1,suite.room.color,'');
  this.plane(150,250,300,190,1,'#647e6b','#a6b99b');this.plane(680,260,175,150,1,'#7d8e69','#afbc8e');this.plane(1000,300,190,180,1,'#658778','#a8bea0');
  for(const p of world.people){const {x,y}=p.home.point;this.plane(x-57,y-72,114,105,1,'#7a947d','#b3c3a1');}
  for(let x=20;x<world.width;x+=65)for(let y=20;y<world.height;y+=65){const p=this.point(x,y);if(!this.visible(p,90))continue;this.line(p,this.point(Math.min(x+65,world.width-20),y),'#213a2d12');this.line(p,this.point(x,Math.min(y+65,world.height-20)),'#213a2d12');}
  for(const s of world.suites){const style=studioStyle(s.room);
   // Floor inlays and offset rugs make the suites feel inhabited without adding geometry or textures.
   this.plane(s.x+22,s.y+105,s.w-55,style.seed%2?240:110,1.2,style.rug,style.trim);
   for(let k=0;k<4;k++)this.plane(s.x+28,s.y+110+k*7,42,2,1.3,style.trim,'');
   this.plane(s.door.x-12,s.door.y-22,24,44,1.5,style.trim,'');
  }
 }
 private visible(p:Point,r:number){const c=this.camera;return p.x*c.zoom+c.x>-r*c.zoom&&p.x*c.zoom+c.x<this.width+r*c.zoom&&p.y*c.zoom+c.y>-r*c.zoom&&p.y*c.zoom+c.y<this.height+r*c.zoom;}
 paint(ctx:CanvasRenderingContext2D,world:World,actors:Actor[],time:number,camera:Camera,width:number,height:number,selected:Selection|null,motion:boolean){
  this.ctx=ctx;this.time=time;this.actors=actors;this.motion=motion;this.camera=camera;this.width=width;this.height=height;this.selected=selected;this.hits=[];
  if(world!==this.world){this.prepare(world);const ids=new Set(world.people.map(p=>p.id));for(const id of this.rigs.keys())if(!ids.has(id))this.rigs.delete(id);const urls=new Set(world.suites.map(s=>s.room.logo));for(const url of this.images.keys())if(!urls.has(url))this.images.delete(url);}
  // Cache the entire visible floor. Its grid and material details never repaint during actor motion.
  const floorKey=[width,height,camera.x,camera.y,camera.zoom,camera.portrait].join(':');
  if(!this.floorCache)this.floorCache=document.createElement('canvas');
  if(this.floorKey!==floorKey){const layer=this.floorCache;layer.width=width;layer.height=height;const base=layer.getContext('2d')!;
   this.ctx=base;base.fillStyle='#1f3931';base.fillRect(0,0,width,height);base.translate(camera.x,camera.y);base.scale(camera.zoom,camera.zoom);this.floor(world);this.ctx=ctx;this.floorKey=floorKey;
  }
  const depth=(p:Prop)=>p.depth===0?0:(this.camera.portrait?p.x+p.y*.01:p.y+p.x*.01)+(p.depth-p.x-p.y);
  if(!this.backdrop)this.backdrop=document.createElement('canvas');
  if(this.backdropKey!==floorKey){
   this.backdrop.width=width;this.backdrop.height=height;const base=this.backdrop.getContext('2d')!;
   base.drawImage(this.floorCache,0,0);base.translate(camera.x,camera.y);base.scale(camera.zoom,camera.zoom);this.ctx=base;
   for(const prop of this.props.filter(p=>!p.dynamic).sort((a,b)=>depth(a)-depth(b)))if(this.visible(this.point(prop.x,prop.y),prop.radius))prop.paint();
   this.ctx=ctx;this.backdropHits=this.hits.splice(0);this.backdropKey=floorKey;
  }
  ctx.drawImage(this.backdrop,0,0,width,height);this.hits.push(...this.backdropHits);ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
  const people=new Map(world.people.map(p=>[p.id,p]));
  const props=this.props.filter(p=>p.dynamic);
  for(const actor of actors){const p=people.get(actor.id);if(!p)continue;props.push({x:actor.point.x,y:actor.point.y,radius:110,depth:actor.point.x+actor.point.y+2,paint:()=>{
   const q=this.point(actor.point.x,actor.point.y),selected=this.selected?.kind==='person'&&this.selected.id===actor.id;
   this.ctx.fillStyle=selected?'#b4e6aa88':'#16392b30';this.ctx.beginPath();this.ctx.ellipse(q.x,q.y,18,8,0,0,Math.PI*2);this.ctx.fill();
   let canvas=this.rigs.get(actor.id);if(!canvas){canvas=document.createElement('canvas');canvas.width=256;canvas.height=240;this.rigs.set(actor.id,canvas);}
   const next=actor.route[0],direction=next?this.point(next.x-actor.point.x,next.y-actor.point.y):null;
   const drawActor=direction?{...actor,facing:direction.x<0?-1:1}:actor.arrived&&actor.destination.key.startsWith('desk:')?{...actor,destination:{...actor.destination,pose:'seated' as const}}:actor;
   const height=112.5*employeeAppearance(actor.id).height;
   if(drawOfficeRig(canvas,p.desk.role,drawActor,p.desk.state==='working',motion&&(!actor.arrived||p.desk.state==='working'||actor.destination.amenity==='pool'||actor.destination.amenity==='gaming'||actor.destination.pose==='coffee'||actor.destination.collaboration)?time:0,direction?direction.y<0:actor.destination.view==='rear'||actor.destination.key.startsWith('desk:')||(actor.destination.amenity==='conference'&&Number(actor.destination.key.split(':')[1])>=3)))this.ctx.drawImage(canvas,q.x-60,q.y-height+7.5,120,height);
   else {this.box(actor.point.x-7,actor.point.y-7,14,14,12,24,'#8db69c');this.dot(actor.point.x,actor.point.y,44,8,'#d9b48d');}
   this.hit({kind:'person',id:actor.id},actor.point.x,actor.point.y,0,45,78);
   if(p.desk.waiting||selected||(p.desk.human&&camera.zoom>.45))this.label(actor.point.x,actor.point.y,85,selected||p.desk.human?p.desk.name:`${p.desk.waiting} to review`,p.desk.waiting?'#ffe0a1':'#d7ebd9');
   else if(p.desk.state==='working'&&camera.zoom>=.75)this.label(actor.point.x,actor.point.y,85,`${p.desk.name} · ${(p.desk.says??'Working').slice(0,38)}`);
   if(actor.arrived&&actor.destination.collaboration)this.label(actor.point.x,actor.point.y,105,'•••');
  }});}
  props.sort((a,b)=>depth(a)-depth(b));
  for(const prop of props)if(this.visible(this.point(prop.x,prop.y),prop.radius))prop.paint();
  for(const suite of world.suites){
   const lx=camera.portrait?suite.x+30:suite.x+suite.w*.5,ly=camera.portrait?suite.y+suite.h*.5:suite.y+25,lz=camera.portrait?10:105;
   const p=this.point(lx,ly,lz);if(!this.visible(p,220))continue;
   const room=suite.room,status=room.kind==='management'?room.desks.length+(room.desks.length===1?' person':' people'):room.waiting?room.waiting+' need you':room.working?room.working+' working':room.desks.length+(room.desks.length===1?' employee':' employees');
   const box=this.label(lx,ly,lz,camera.zoom<.35?room.name:`${room.name}  ·  ${status}`,room.waiting?'#f4d294':'#daeadb','#1b3533',12,true);this.hits.push({target:{kind:'company',id:room.companyId},...box});
  }

  ctx.restore();return this.hits;
 }
 dispose(){releaseOfficeAppearances();this.clearArt();if(this.backdrop){this.backdrop.width=0;this.backdrop.height=0;}this.backdrop=null;if(this.floorCache){this.floorCache.width=0;this.floorCache.height=0;}this.floorCache=null;for(const image of this.images.values())image.onload=null;this.rigs.clear();this.images.clear();this.props=[];this.world=null;}
}
