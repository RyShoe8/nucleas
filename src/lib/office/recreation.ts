/** Small deterministic games. Only actions are persisted; no timer or per-frame database writes. */
export type Ball={id:number;x:number;y:number;vx:number;vy:number;pocketed:boolean};
export const TABLE={width:320,height:160,radius:5,pocket:12};
export const BALL_COLORS=['#fff4d6','#f6c14b','#6da7e8','#d96b58','#a2ce75','#edac66','#4bb8b3','#e49dbe','#252f32'];
export function rack():Ball[]{
 const balls:Ball[]=[{id:0,x:80,y:80,vx:0,vy:0,pocketed:false}];
 for(let row=0,id=1;id<9;row++)for(let col=0;col<=row&&id<9;col++,id++)balls.push({id,x:225+row*9,y:80+(col-row/2)*10.2,vx:0,vy:0,pocketed:false});
 return balls;
}
const pockets=[{x:0,y:0},{x:160,y:0},{x:320,y:0},{x:0,y:160},{x:160,y:160},{x:320,y:160}];
export function simulateShot(input:Ball[],angle:number,power:number){
 const balls=input.map(b=>({...b,vx:0,vy:0})),frames:Ball[][]=[];
 const cue=balls.find(b=>b.id===0)!;cue.vx=Math.cos(angle)*power;cue.vy=Math.sin(angle)*power;
 let ticks=0,scratch=false;
 const copy=()=>balls.map(b=>({...b}));frames.push(copy());
 for(;ticks<1800;ticks++){
  let moving=false;
  for(const b of balls){
   if(b.pocketed)continue;
   b.x+=b.vx/120;b.y+=b.vy/120;
   if(pockets.some(p=>Math.hypot(b.x-p.x,b.y-p.y)<TABLE.pocket)){b.pocketed=true;b.vx=b.vy=0;if(b.id===0)scratch=true;continue;}
   if(b.x<5){b.x=5;b.vx=Math.abs(b.vx)*.86;}if(b.x>315){b.x=315;b.vx=-Math.abs(b.vx)*.86;}
   if(b.y<5){b.y=5;b.vy=Math.abs(b.vy)*.86;}if(b.y>155){b.y=155;b.vy=-Math.abs(b.vy)*.86;}
   const speed=Math.hypot(b.vx,b.vy),next=Math.max(0,speed-42/120);
   if(speed){b.vx*=next/speed;b.vy*=next/speed;}if(next>.1)moving=true;
  }
  for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
   const a=balls[i],b=balls[j];if(a.pocketed||b.pocketed)continue;
   const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>=10||d===0)continue;
   const nx=dx/d,ny=dy/d,over=(10-d)/2;a.x-=nx*over;a.y-=ny*over;b.x+=nx*over;b.y+=ny*over;
   const speed=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;if(speed<=0)continue;
   a.vx-=speed*nx;a.vy-=speed*ny;b.vx+=speed*nx;b.vy+=speed*ny;moving=true;
  }
  if(ticks%4===3)frames.push(copy());if(!moving)break;
 }
 // A scratch returns the cue to a clear spot instead of trapping the next player.
 if(scratch){const spot=Array.from({length:24},(_,i)=>({x:40+(i%4)*24,y:30+Math.floor(i/4)*20})).find(p=>balls.every(b=>b.id===0||b.pocketed||Math.hypot(b.x-p.x,b.y-p.y)>11))!;Object.assign(cue,spot,{pocketed:false});}
 for(const b of balls)b.vx=b.vy=0;
 frames.push(copy());return {balls,frames,duration:(ticks+1)/120,scratch};
}
export interface Recreation {
 revision:number;updatedAt:number;
 pool:{balls:Ball[];shots:number;scratch:boolean;lastShot?:{at:number;balls:Ball[];angle:number;power:number;duration:number}};
 tv:{on:boolean;cards:number[];open:number[];matched:number[];moves:number;revealUntil:number};
 projectorSlide?:number;
 objects:Partial<Record<'coffee'|'water'|'plant'|'projector'|'reception',number>>;
}
export type RecreationAction=
 |{kind:'pool-shot';revision:number;angle:number;power:number}
 |{kind:'pool-reset'|'tv-power'|'tv-reset';revision:number}
 |{kind:'tv-card';revision:number;card:number}
 |{kind:'object-use';revision:number;object:keyof Recreation['objects']};
function deck(seed:number){const values=Array.from({length:12},(_,i)=>i%6);for(let i=11;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[values[i],values[j]]=[values[j],values[i]];}return values;}
export function newRecreation(now:number):Recreation{return {revision:0,updatedAt:0,pool:{balls:rack(),shots:0,scratch:false},tv:{on:true,cards:deck(now>>>0),open:[],matched:[],moves:0,revealUntil:0},objects:{}};}
export function poolBusy(state:Recreation,now:number){const shot=state.pool.lastShot;return Boolean(shot&&now<shot.at+shot.duration*1000);}
export function changeRecreation(current:Recreation,action:RecreationAction,now:number):Recreation {
 if(current.revision!==action.revision)throw Error('Someone else used this game. Your view is refreshing; try again.');
 const state=structuredClone(current);
 if(action.kind==='pool-shot'){
  if(poolBusy(state,now))throw Error('Wait for the balls to stop.');
  if(!Number.isFinite(action.angle)||!Number.isFinite(action.power)||action.power<50||action.power>500)throw Error('Invalid shot.');
  const shot=simulateShot(state.pool.balls,action.angle,action.power);
  state.pool={balls:shot.balls,shots:state.pool.shots+1,scratch:shot.scratch,lastShot:{at:now,balls:state.pool.balls,angle:action.angle,power:action.power,duration:shot.duration}};
 }else if(action.kind==='pool-reset'){
  if(poolBusy(state,now))throw Error('Wait for the balls to stop.');
  state.pool={balls:rack(),shots:0,scratch:false};
 }else if(action.kind==='tv-power')state.tv.on=!state.tv.on;
 else if(action.kind==='tv-reset')state.tv={on:true,cards:deck(now>>>0),open:[],matched:[],moves:0,revealUntil:0};
 else if(action.kind==='tv-card'){
  const tv=state.tv;if(!tv.on)throw Error('Turn the TV on first.');
  if(!Number.isInteger(action.card)||action.card<0||action.card>=12)throw Error('Invalid card.');
  if(tv.open.length===2){if(now<tv.revealUntil)throw Error('Let everyone see the cards first.');tv.open=[];}
  if(tv.matched.includes(action.card)||tv.open.includes(action.card))throw Error('Choose a face-down card.');
  tv.open.push(action.card);
  if(tv.open.length===2){tv.moves++;if(tv.cards[tv.open[0]]===tv.cards[tv.open[1]]){tv.matched.push(...tv.open);tv.open=[];}else tv.revealUntil=now+1800;}
 }else if(action.kind==='object-use'){state.objects[action.object]=now;if(action.object==='projector')state.projectorSlide=((state.projectorSlide??0)+1)%3;}
 state.revision++;state.updatedAt=now;return state;
}
