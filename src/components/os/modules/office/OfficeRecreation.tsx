'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {BALL_COLORS,poolBusy,simulateShot,type Recreation} from '@/lib/office/recreation';
import type {Amenity} from './officeActivities';
import type {SharedOffice} from './useSharedOffice';
import styles from './OfficeRecreation.module.css';

const symbols=['◆','★','●','♣','♥','☀'];
export default function OfficeRecreation({amenity,shared,motion}:{amenity:Amenity;shared:SharedOffice;motion:boolean}){
 const state=shared.frame?.snapshot.scene.recreation;
 return state?<RecreationControls key={amenity} amenity={amenity} state={state} shared={shared} motion={motion}/>:null;
}
function RecreationControls({amenity,state,shared,motion}:{amenity:Amenity;state:Recreation;shared:SharedOffice;motion:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),[angle,setAngle]=useState(0),[power,setPower]=useState(300),[finishedAt,setFinishedAt]=useState(0);
 const frame=shared.frame!;
 const shot=state.pool.lastShot;
 const simulation=useMemo(()=>shot?simulateShot(shot.balls,shot.angle,shot.power):null,[shot]);
 // One wake-up at each state transition. Hidden/minimized views do not run a game loop.
 useEffect(()=>{
  const until=amenity==='pool'&&shot?shot.at+shot.duration*1000:state.tv.revealUntil;
  const remaining=until-(frame.snapshot.serverTime+performance.now()-frame.receivedAt);
  if(until<=frame.snapshot.serverTime)return;
  const timer=setTimeout(()=>setFinishedAt(until),Math.max(0,remaining)+40);return()=>clearTimeout(timer);
 },[amenity,shot,state.tv.revealUntil,frame]);
 useEffect(()=>{
  const el=canvas.current,c=el?.getContext('2d');if(!el||!c)return;
  let timer:ReturnType<typeof setTimeout>|undefined,visible=true;
  const paint=()=>{
   clearTimeout(timer);if(document.hidden||!visible)return;
   const now=frame.snapshot.serverTime+performance.now()-frame.receivedAt,elapsed=shot?(now-shot.at)/1000:0,moving=poolBusy(state,now);
   const balls=moving&&motion&&simulation?simulation.frames[Math.min(simulation.frames.length-1,Math.max(0,Math.floor(elapsed*30)))]:state.pool.balls;
   c.imageSmoothingEnabled=false;c.fillStyle='#392d26';c.fillRect(0,0,360,200);
   c.fillStyle='#b08951';c.fillRect(4,4,352,192);c.fillStyle='#5b4030';c.fillRect(10,10,340,180);
   c.fillStyle='#245b43';c.fillRect(20,20,320,160);
   for(let y=22;y<180;y+=4){c.fillStyle=y%8?'#285f47':'#265d45';c.fillRect(20,y,320,1);}
   for(const x of [20,180,340])for(const y of [20,180]){c.fillStyle='#192722';c.beginPath();c.arc(x,y,11,0,Math.PI*2);c.fill();}
   for(const x of [60,100,140,220,260,300])for(const y of [11,188]){c.fillStyle='#e4cb91';c.fillRect(x,y,2,2);}
   const cue=balls[0];
   if(!moving){c.strokeStyle='#dbecc178';c.setLineDash([3,4]);c.beginPath();c.moveTo(20+cue.x,20+cue.y);c.lineTo(20+cue.x+Math.cos(angle)*100,20+cue.y+Math.sin(angle)*100);c.stroke();c.setLineDash([]);c.strokeStyle='#d7b276';c.lineWidth=3;c.beginPath();c.moveTo(20+cue.x-Math.cos(angle)*12,20+cue.y-Math.sin(angle)*12);c.lineTo(20+cue.x-Math.cos(angle)*(30+power/15),20+cue.y-Math.sin(angle)*(30+power/15));c.stroke();c.lineWidth=1;}
   for(const ball of balls){if(ball.pocketed)continue;const x=Math.round(ball.x+20),y=Math.round(ball.y+20);c.fillStyle='#162f2a';c.fillRect(x-4,y-3,9,9);c.fillStyle=BALL_COLORS[ball.id];c.fillRect(x-4,y-4,8,7);c.fillStyle='#fff4d7';c.fillRect(x-2,y-3,2,2);}
   if(moving&&motion)timer=setTimeout(paint,1000/24);
  };
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)paint();else clearTimeout(timer);});observer.observe(el);
  document.addEventListener('visibilitychange',paint);paint();
  return()=>{clearTimeout(timer);observer.disconnect();document.removeEventListener('visibilitychange',paint);};
 },[state,simulation,shot,angle,power,motion,frame]);
 const now=Math.max(frame.snapshot.serverTime,finishedAt),busy=poolBusy(state,now),send=shared.play,revision=state.revision;
 if(amenity==='pool')return <section className={styles.game} aria-label="Shared pool game">
  <strong>Take a shot</strong><small>Shared table · {state.pool.shots} shots · {state.pool.balls.filter(b=>b.id&&b.pocketed).length}/8 pocketed</small>
  <canvas ref={canvas} width={360} height={200} aria-label="Pool table. Tap to aim, or use the aim slider below." onPointerDown={e=>{if(busy)return;const r=e.currentTarget.getBoundingClientRect(),cue=state.pool.balls[0];setAngle(Math.atan2((e.clientY-r.top)*200/r.height-20-cue.y,(e.clientX-r.left)*360/r.width-20-cue.x));}}/>
  <label>Aim · {Math.round(angle*180/Math.PI)}°<input aria-label="Pool aim" type="range" min={-180} max={180} value={angle*180/Math.PI} onChange={e=>setAngle(Number(e.target.value)*Math.PI/180)}/></label>
  <label>Power · {Math.round(power/5)}%<input aria-label="Shot power" type="range" min={50} max={500} value={power} onChange={e=>setPower(Number(e.target.value))}/></label>
  <div className={styles.buttons}><button disabled={shared.saving||busy} onClick={()=>void send({kind:'pool-shot',revision,angle,power})}>{busy?'Balls moving…':'Shoot'}</button><button disabled={shared.saving||busy} onClick={()=>void send({kind:'pool-reset',revision})}>New rack</button></div>
  <small aria-live="polite">{busy?'Watch the shot play out.':state.pool.balls.filter(b=>b.id&&!b.pocketed).length===0?'Table cleared! Start a new rack.':state.pool.scratch?'Scratch — the cue ball has been returned to a clear spot.':'Pocket all eight colored balls. Tap the felt to aim. Everyone sees the same game.'}</small>
 </section>;
 if(amenity==='gaming'||amenity==='couch'){
  const tv=state.tv,open=tv.open.length===2&&now>=tv.revealUntil?[]:tv.open,locked=tv.open.length===2&&now<tv.revealUntil;
  return <section className={styles.game} aria-label="Shared TV game"><strong>Memory console</strong><small>Match six pairs together · {tv.moves} turns · {tv.matched.length/2}/6 pairs</small>
   {tv.on?<div className={styles.cards}>{tv.cards.map((symbol,i)=>{const face=open.includes(i)||tv.matched.includes(i);return <button key={i} aria-label={`Card ${i+1}${face?`: ${symbols[symbol]}`:''}`} aria-pressed={face} disabled={shared.saving||locked||face} className={tv.matched.includes(i)?styles.matched:''} onClick={()=>void send({kind:'tv-card',revision,card:i})}>{face?symbols[symbol]:'?'}</button>;})}</div>:<p className={styles.off}>TV is off</p>}
   {tv.matched.length===12&&<p role="status">All pairs found in {tv.moves} turns!</p>}
   <div className={styles.buttons}><button disabled={shared.saving} onClick={()=>void send({kind:'tv-power',revision})}>{tv.on?'Turn TV off':'Turn TV on'}</button><button disabled={shared.saving} onClick={()=>void send({kind:'tv-reset',revision})}>New game</button></div><small>Everyone in the organization shares this console.</small>
  </section>;
 }
 const action=amenity==='coffee'?'Brew coffee':amenity==='water'?'Fill a glass':amenity==='plant'?'Water the plant':amenity==='projector'?'Switch presentation':amenity==='reception'?'Ring the bell':null;
 if(!action)return null;
 const object=amenity as keyof Recreation['objects'],recent=state.objects[object];
 return <section className={styles.game}><button disabled={shared.saving} onClick={()=>void send({kind:'object-use',revision,object})}>{action}</button>{recent&&<small role="status">{amenity==='coffee'?'Fresh coffee is ready.':amenity==='water'?'A fresh glass of water.':amenity==='plant'?'Plant watered.':amenity==='projector'?'Presentation changed.':'Reception bell rung.'} Invite a teammate to join you.</small>}</section>;
}
