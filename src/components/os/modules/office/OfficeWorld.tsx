'use client';
import {useRef,useState} from 'react';
import type {Desk,Room} from './officeState';
import {AMENITIES,type Amenity} from './officeActivities';
import {scenePoint,uniso} from './gameCamera';
import {AMENITY_POSITION} from './officeSimulation';
import OfficeGameCanvas,{type GameControls,type GameView} from './OfficeGameCanvas';
import type {Selection} from './OfficeGameRenderer';
import type {SharedOffice} from './useSharedOffice';
import styles from './OfficeGame.module.css';

export default function OfficeWorld({rooms,shared,onOpenRoom,onOpenDesk}:{rooms:Room[];shared:SharedOffice;onOpenRoom:(room:Room)=>void;onOpenDesk:(room:Room,desk:Desk)=>void}){
 const root=useRef<HTMLDivElement>(null),game=useRef<GameControls>(null);
 const [selection,setSelection]=useState<Selection|null>(null),[motion,setMotion]=useState(true),[view,setView]=useState<GameView|null>(null),[fullError,setFullError]=useState('');
 const world=shared.frame?.snapshot.scene.world;
 if(!world)return <p>Connecting to your office…</p>;
 const person=selection?.kind==='person'?world.people.find(p=>p.id===selection.id):null;
 const company=selection?.kind==='company'?rooms.find(r=>r.companyId===selection.id):person?.room;
 const amenity=selection?.kind==='amenity'?selection.id as Amenity:null;
 const actor=person?shared.frame?.snapshot.scene.actors.find(a=>a.id===person.id):null;
 const focus=(id:string)=>{const suite=world.suites.find(s=>s.room.companyId===id);if(suite){game.current?.focus({x:suite.x+suite.w/2,y:suite.y+suite.h/2});setSelection({kind:'company',id});}};
 const visit=async(id:string,target:Amenity|'desk')=>{const p=world.people.find(p=>p.id===id);if(p)await shared.visit(p.room.companyId,p.desk.role,target);};
 const fullscreen=async()=>{setFullError('');try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();}catch{setFullError('Full screen is unavailable in this window. You can maximize the app instead.');}};
 const corners=view?[[0,0],[view.width,0],[view.width,view.height],[0,view.height]].map(([x,y])=>uniso(scenePoint({x,y},view.camera))).map(p=>`${p.x},${p.y}`).join(' '):'';
 return <div ref={root} className={styles.world}>
  <OfficeGameCanvas ref={game} world={world} frame={shared.frame} motion={motion} selection={selection} onSelect={setSelection} onView={setView}/>
  <div className={styles.top}>
   <div className={styles.identity}><i/><span><strong>Organization office</strong><small>{shared.error?'Reconnecting…':shared.saving?'Updating shared activity…':'One shared world · live work, ambient breaks'}</small></span></div>
   <select aria-label="Go to company" value={amenity?`amenity:${amenity}`:company?.companyId??''} onChange={e=>{if(e.target.value==='commons'){game.current?.focus({x:650,y:300},.8);setSelection(null);}else if(e.target.value.startsWith('amenity:')){const id=e.target.value.slice(8) as Amenity;game.current?.focus(AMENITY_POSITION[id],1);setSelection({kind:'amenity',id});}else focus(e.target.value);}}><option value="">Explore the office</option><option value="commons">The commons</option><optgroup label="Our companies">{rooms.filter(r=>r.relationship!=='client').map(r=><option key={r.companyId} value={r.companyId}>{r.name}{r.waiting?` · ${r.waiting} need you`:''}</option>)}</optgroup><optgroup label="Client studios">{rooms.filter(r=>r.relationship==='client').map(r=><option key={r.companyId} value={r.companyId}>{r.name}{r.waiting?` · ${r.waiting} need you`:''}</option>)}</optgroup><optgroup label="Shared spaces">{Object.entries(AMENITIES).map(([id,a])=><option key={id} value={`amenity:${id}`}>{a.name}</option>)}</optgroup></select>
  </div>
  {selection&&<aside className={styles.inspector} aria-label="Office selection">
   <button type="button" className={styles.close} onClick={()=>setSelection(null)} aria-label="Close selection">×</button>
   {person&&company?<><span className={styles.kicker}>{company.name}</span><h2>{person.desk.name}</h2><p>{person.desk.says??(person.desk.state==='away'?'No assigned work':'Available for work')}</p><small>{actor?.arrived?actor.destination.label:`Walking to ${actor?.destination.label??'their desk'}`}</small>
    <button type="button" className={styles.primary} onClick={()=>onOpenDesk(company,person.desk)}>Open assigned work{person.desk.waiting?` · ${person.desk.waiting} to review`:''} ↗</button>
    <button type="button" onClick={()=>onOpenRoom(company)}>Company & data</button>
    {!['working','waiting'].includes(person.desk.state)&&<><label>Visit a shared space<select aria-label="Send member to amenity" disabled={shared.saving} value="" onChange={e=>void visit(person.id,e.target.value as Amenity)}><option value="">Choose an activity</option>{Object.entries(AMENITIES).map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label><button type="button" disabled={shared.saving} onClick={()=>void visit(person.id,'desk')}>Return to desk</button></>}
   </>:company?<><span className={styles.kicker}>{company.relationship==='client'?'Client studio':'Our company'}</span><h2>{company.name}</h2><p>{company.waiting?`${company.waiting} items need your review`:company.working?`${company.working} team members working`:'Team available'}</p><div className={styles.metrics}>{company.screens.map(s=><div key={s.label}><b>{s.value}</b><small>{s.label} · 7 days</small></div>)}</div><button type="button" className={styles.primary} onClick={()=>onOpenRoom(company)}>Open company ↗</button><div className={styles.team}>{company.desks.map(d=><button type="button" key={d.role} onClick={()=>{const p=world.people.find(p=>p.room.companyId===company.companyId&&p.desk.role===d.role);if(p)setSelection({kind:'person',id:p.id});else onOpenDesk(company,d);}}><strong>{d.name}</strong><small>{d.says??`${d.jobs} assignments · ${d.state}`}</small></button>)}</div></>:amenity?<><span className={styles.kicker}>The commons</span><h2>{AMENITIES[amenity].name}</h2><p>Shared by every company. Activities here are ambient and do not change assigned work.</p><small>{AMENITIES[amenity].capacity} places · working members stay on task</small><label>Invite an available member<select aria-label="Choose available member" disabled={shared.saving} value="" onChange={e=>void visit(e.target.value,amenity)}><option value="">Choose a team member</option>{world.people.filter(p=>p.desk.state==='idle'||p.desk.state==='away').map(p=><option key={p.id} value={p.id}>{p.room.name} · {p.desk.name}</option>)}</select></label><ul>{shared.frame?.snapshot.scene.actors.filter(a=>a.destination.amenity===amenity||(['couch','gaming'].includes(amenity)&&['couch','gaming'].includes(a.destination.amenity??''))).map(a=>{const p=world.people.find(p=>p.id===a.id);return p&&<li key={a.id}><button type="button" onClick={()=>setSelection({kind:'person',id:a.id})}>{p.room.name} · {p.desk.name}<small>{a.arrived?'Here':'Walking over'}</small></button></li>;})}</ul></>:null}
   {shared.error&&<p role="alert">{shared.error}</p>}
  </aside>}
  <div className={styles.bottom}>
   <div className={styles.navigation}><button type="button" aria-label="Zoom out" onClick={()=>game.current?.zoom(1/1.2)}>−</button><output>{Math.round((view?.camera.zoom??1)*100)}%</output><button type="button" aria-label="Zoom in" onClick={()=>game.current?.zoom(1.2)}>+</button><button type="button" onClick={()=>game.current?.fit()}>Whole office</button><button type="button" onClick={()=>void fullscreen()} aria-label="Toggle full screen">⛶</button><button type="button" aria-pressed={!motion} onClick={()=>setMotion(v=>!v)}>{motion?'Reduce motion':'Animate'}</button></div>
   <span className={styles.help}>Drag to explore · scroll / pinch to zoom · click to interact</span>
  </div>
  <div className={styles.minimap}><span>FLOOR PLAN</span><svg viewBox={`0 0 ${world.width} ${world.height}`} role="button" tabIndex={0} aria-label="Office minimap. Click to move camera; Enter shows the whole office." onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();game.current?.fit();}}} onClick={e=>{const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());game.current?.focus(p,view?.camera.zoom);}}><rect width={world.width} height={world.height} fill="#27473d"/><rect x="30" y="30" width="580" height="480" fill="#647f68"/><rect x="650" y="30" width="600" height="480" fill="#647f68"/>{world.suites.map(s=><rect key={s.room.companyId} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.room.waiting?'#c0a06a':s.room.relationship==='client'?'#73988e':'#a0b99b'}/>)}{shared.frame?.snapshot.scene.actors.map(a=><circle key={a.id} cx={a.point.x} cy={a.point.y} r="10" fill="#e1e9cb"/>)}{corners&&<polygon points={corners} fill="#bfe4c21a" stroke="#e1f0cb" strokeWidth="9"/>}</svg></div>
  {fullError&&<p role="alert" className={styles.error}>{fullError}</p>}
 </div>;
}
