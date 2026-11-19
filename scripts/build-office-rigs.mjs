// Packs generated parts, authors native Rigby projects, and samples their exact runtime quads.
// No editor or LLM runs in the office. These same work files open in Animation Studio.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { Skeleton } from '../vendor/rigby/src/core/model.js';
import { Pose } from '../vendor/rigby/src/core/pose.js';
import { AnimationState } from '../vendor/rigby/src/core/state.js';
import { zip } from '../vendor/rigby/src/editor/zip.js';

const roles=['design','creative','engineering','support','operations','marketing'];
const columns=[0,260,480,670,860,1060,1254];
const out='public/office/rigs';await fs.mkdir(out,{recursive:true});
const parts=[['head',110,110],['torso',90,100],['left-arm',27,110],['right-arm',27,110],['left-leg',35,132],['right-leg',35,132]];
const bone=(name,parent,x=0,y=0)=>({name,parent,x,y,length:0,rotation:0,scale_x:1,scale_y:1});
const bones=[bone('root',null),bone('body',0,0,128),bone('head',1,0,90),bone('left-thigh',0,-22,138),bone('left-shin',3,0,-66),bone('right-thigh',0,22,138),bone('right-shin',5,0,-66),bone('left-upper-arm',1,-33,78),bone('left-forearm',7,0,-49),bone('right-upper-arm',1,33,78),bone('right-forearm',9,0,-49)];
const specs=[['left-thigh',3,35,73,0,-36.5],['left-shin',4,35,66,0,-33],['right-thigh',5,35,73,0,-36.5],['right-shin',6,35,66,0,-33],['torso',1,90,100,0,45],['left-upper-arm',7,27,56,0,-28],['left-forearm',8,27,61,0,-30.5],['right-upper-arm',9,27,56,0,-28],['right-forearm',10,27,61,0,-30.5],['head',2,110,110,0,55],['cup',10,24,25,0,-58],['cue',10,6,190,0,-110]];
const key=(time,value)=>({time,value,curve:{bezier:[.3,0,.65,1]}});
const rotate=(bone,values,duration)=>({bone,rotate:values.map((v,i)=>key(i*duration/(values.length-1),v))});
const translate=(bone,values,duration)=>({bone,translate:values.map((v,i)=>key(i*duration/(values.length-1),v))});
const props=(cup=false,cue=false)=>[{slot:10,attachment:[{time:0,value:cup?'cup':null,curve:'stepped'}]},{slot:11,attachment:[{time:0,value:cue?'cue':null,curve:'stepped'}]}];
const seated=[translate(0,[[0,-30],[0,-30]],2),rotate(3,[62,62],2),rotate(4,[-62,-62],2),rotate(5,[62,62],2),rotate(6,[-62,-62],2)];
const animations=[
  {name:'idle',duration:3,bones:[translate(1,[[0,0],[0,1.5],[0,0]],3),rotate(2,[0,2,0],3)],slots:props()},
  // The toes face +X: knees flex toward -X during recovery, never forward past straight.
  {name:'walk',duration:.9,bones:[translate(0,[[0,0],[0,3],[0,0],[0,3],[0,0]],.9),rotate(3,[-22,0,22,0,-22],.9),rotate(5,[22,0,-22,0,22],.9),rotate(4,[-8,-38,-4,0,-8],.9),rotate(6,[-4,0,-8,-38,-4],.9),rotate(7,[20,-20,20],.9),rotate(9,[-20,20,-20],.9),rotate(8,[8,18,8],.9),rotate(10,[18,8,18],.9)],slots:props()},
  {name:'type',duration:2,bones:[...seated,rotate(7,[42,44,42],2),rotate(9,[55,53,55],2),rotate(8,[39,43,37,41,39],2),rotate(10,[31,27,33,29,31],2),rotate(2,[-3,-1,-3],2)],slots:props()},
  {name:'sit',duration:3,bones:[...seated,rotate(8,[12,12],3),rotate(10,[12,12],3),rotate(2,[0,2,0],3)],slots:props()},
  {name:'talk',duration:3,bones:[rotate(2,[0,-4,2,0],3),rotate(9,[0,-28,-25,0],3),rotate(10,[0,-65,-55,0],3),rotate(8,[10,16,10],3)],slots:props()},
  {name:'coffee',duration:5,bones:[rotate(9,[0,-30,-40,-40,0],5),rotate(10,[0,-105,-110,-110,0],5),rotate(2,[0,4,4,0,0],5)],slots:props(true)},
  {name:'pool',duration:4,bones:[rotate(1,[0,7,7,0],4),rotate(9,[40,65,70,40],4),rotate(10,[35,25,10,35],4),rotate(7,[10,45,45,10],4),rotate(8,[40,60,60,40],4),rotate(2,[0,-4,-4,0],4)],slots:props(false,true)},
  {name:'game',duration:2,bones:[...seated,rotate(7,[25,27,25],2),rotate(9,[-25,-27,-25],2),rotate(8,[65,63,65],2),rotate(10,[-65,-63,-65],2),rotate(2,[-1,2,-1],2)],slots:props()},
  {name:'lounge',duration:3,bones:[translate(0,[[0,-30],[0,-30]],3),rotate(7,[-12,-14,-12],3),rotate(9,[12,14,12],3),rotate(2,[-1,2,-1],3)],slots:props()},
];
let motion;
for(const rear of [false,true]) for(let row=0;row<roles.length;row++) {
  const suffix=rear?'-rear':'';
  const images=new Map();
  for(let col=0;col<6;col++) {
    const [name,w,h]=parts[col];
    const cell=await sharp(`design/office-characters/rig-parts${rear?'-rear':''}-atlas.png`).extract({left:columns[col],top:row*209,width:columns[col+1]-columns[col],height:209}).png().toBuffer();
    const png=await sharp(cell).trim({threshold:12}).resize(w,h,{fit:'fill'}).png().toBuffer();
    if(name.endsWith('-arm')) { const side=name.split('-')[0]; images.set(`${side}-upper-arm`,await sharp(png).extract({left:0,top:0,width:w,height:56}).png().toBuffer()); images.set(`${side}-forearm`,await sharp(png).extract({left:0,top:49,width:w,height:61}).png().toBuffer()); }
    else if(name.endsWith('-leg')) {const side=name.split('-')[0]; images.set(`${side}-thigh`,await sharp(png).extract({left:0,top:0,width:w,height:73}).png().toBuffer());images.set(`${side}-shin`,await sharp(png).extract({left:0,top:66,width:w,height:66}).png().toBuffer());}
    else images.set(name,png);
  }
  const svgPng=svg=>sharp(Buffer.from(svg)).png().toBuffer();
  images.set('cup',await svgPng('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="25"><path d="M17 6h4c4 0 4 10 0 10h-4" fill="none" stroke="#b9d6da" stroke-width="3"/><rect x="1" y="2" width="17" height="21" rx="4" fill="#eef7fa"/><ellipse cx="9.5" cy="4" rx="7" ry="2" fill="#513321"/></svg>'));
  images.set('cue',await svgPng('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="190"><path d="M2 0h2l2 188H0Z" fill="#cfa468"/><path d="M0 125h6v63H0Z" fill="#473025"/><path d="M2 0h2v4H2Z" fill="#75b5b8"/></svg>'));
  const project={format:'rigby-snapshot/1',name:`Nucleas ${roles[row]}${rear?' rear view':''}`,textureFilter:'linear',bones,images:specs.map(([name,,width,height])=>({name,width,height})),
    slots:specs.map(([name,bone,width,height,x,y],index)=>({name,bone,attachment:index<10?name:null,color:[1,1,1,1],attachments:[{name,image:name,width,height,x,y,rotation:0,scale_x:1,scale_y:1}]})),animations};
  const sk=Skeleton.fromJson(JSON.stringify(project)); // Reject malformed authoring before shipping.
  await fs.writeFile(`${out}/${roles[row]}${suffix}.rigby`,zip([{path:'project.json',bytes:Buffer.from(sk.toJson())},...[...images].map(([name,bytes])=>({path:`images/${name}.png`,bytes}))],new Date('2026-11-19T00:00:00Z')));
  const regions=specs.map(([, ,w,h],i)=>[i%4*128,Math.floor(i/4)*128,w,h]);
  await sharp({create:{width:512,height:512,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(specs.map(([name],i)=>({input:images.get(name),left:regions[i][0],top:regions[i][1]}))).webp({lossless:true}).toFile(`${out}/${roles[row]}${suffix}.webp`);
  if(!motion) {
    motion={fps:24,regions,clips:{}};
    for(const clip of animations) {
      const pose=new Pose(sk),state=new AnimationState();state.play(sk,clip.name,true);
      const frames=[];
      for(let tick=0;tick<Math.ceil(clip.duration*24);tick++) {
        if(tick)state.update(sk,1/24);state.apply(sk,pose);
        frames.push(pose.quads(sk).map(q=>{const [a,b,,d]=q.positions;return [specs.findIndex(s=>s[0]===q.image),b[0]-a[0],b[1]-a[1],d[0]-a[0],d[1]-a[1],a[0],a[1]].map(n=>Math.round(n*100)/100);}));
      }
      motion.clips[clip.name]=frames;
    }
  }
}
await fs.writeFile(`${out}/motion.json`,JSON.stringify(motion));
console.log('Six editable Rigby characters, front and rear views; shared animation tracks, 24 fps.');
