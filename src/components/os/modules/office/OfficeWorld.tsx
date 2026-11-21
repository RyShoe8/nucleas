'use client';
import {useRef,useState,useSyncExternalStore} from 'react';
import OfficeRecreation from './OfficeRecreation';
import ManagementEmployees from './ManagementEmployees';
const motionSubscribe=(callback:()=>void)=>{const q=matchMedia('(prefers-reduced-motion: reduce)');q.addEventListener('change',callback);return()=>q.removeEventListener('change',callback);};
const systemMotion=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches;
import type {Desk,Room} from './officeState';
import {AMENITIES,type Amenity} from './officeActivities';
import {AMENITY_POSITION} from './officeSimulation';
import OfficeGameCanvas,{type GameControls,type GameView} from './OfficeGameCanvas';
import type {Selection} from './OfficeGameRenderer';
import type {SharedOffice} from './useSharedOffice';
import styles from './OfficeGame.module.css';
import {TEAM} from '@/lib/companies/teamRoles';

export default function OfficeWorld({rooms,shared,onOpenRoom,onOpenDesk}:{rooms:Room[];shared:SharedOffice;onOpenRoom:(room:Room)=>void;onOpenDesk:(room:Room,desk:Desk)=>void}){
 const root=useRef<HTMLDivElement>(null),game=useRef<GameControls>(null);
 const [selection,setSelection]=useState<Selection|null>(null),[motionOverride,setMotion]=useState<boolean|null>(null),[view,setView]=useState<GameView|null>(null),[fullError,setFullError]=useState('');
 const systemAllowsMotion=useSyncExternalStore(motionSubscribe,systemMotion,()=>true),motion=motionOverride??systemAllowsMotion;
 const world=shared.frame?.snapshot.scene.world;
 if(!world)return <p>Connecting to your office…</p>;
 const person=selection?.kind==='person'?world.people.find(p=>p.id===selection.id):null;
 const company=selection?.kind==='company'?rooms.find(r=>r.companyId===selection.id):person?.room;
 const amenity=selection?.kind==='amenity'?selection.id as Amenity:null;
 const actor=person?shared.frame?.snapshot.scene.actors.find(a=>a.id===person.id):null;
 const focus=(id:string)=>{const suite=world.suites.find(s=>s.room.companyId===id);if(suite){game.current?.focus({x:suite.x+suite.w/2,y:suite.y+suite.h/2});setSelection({kind:'company',id});}};
 const visit=async(id:string,target:Amenity|'desk')=>{const p=world.people.find(p=>p.id===id);if(p)await shared.visit(p.room.companyId,p.desk.role,target,p.desk.instanceId);};
 const fullscreen=async()=>{setFullError('');try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();}catch{setFullError('Full screen is unavailable in this window. You can maximize the app instead.');}};
 return <div ref={root} className={styles.world}>
  <OfficeGameCanvas ref={game} world={world} frame={shared.frame} motion={motion} selection={selection} onSelect={setSelection} onView={setView}/>
  <div className={styles.top}>
   <select aria-label="Go to company" value={amenity?`amenity:${amenity}`:company?.companyId??''} onChange={e=>{if(e.target.value==='commons'){game.current?.focus({x:650,y:300},.8);setSelection(null);}else if(e.target.value.startsWith('amenity:')){const id=e.target.value.slice(8) as Amenity;game.current?.focus(AMENITY_POSITION[id],1);setSelection({kind:'amenity',id});}else focus(e.target.value);}}><option value="">Explore the office</option><option value="commons">The commons</option>{rooms.some(r=>r.kind==='management')&&<option value="management">Management · human team</option>}<optgroup label="Our companies">{rooms.filter(r=>r.relationship!=='client'&&r.kind!=='management').map(r=><option key={r.companyId} value={r.companyId}>{r.name}{r.waiting?` · ${r.waiting} need you`:''}</option>)}</optgroup><optgroup label="Client studios">{rooms.filter(r=>r.relationship==='client').map(r=><option key={r.companyId} value={r.companyId}>{r.name}{r.waiting?` · ${r.waiting} need you`:''}</option>)}</optgroup><optgroup label="Shared spaces">{Object.entries(AMENITIES).map(([id,a])=><option key={id} value={`amenity:${id}`}>{a.name}</option>)}</optgroup></select>
  </div>
  {selection&&<aside className={styles.inspector} aria-label="Office selection">
   <button type="button" className={styles.close} onClick={()=>setSelection(null)} aria-label="Close selection">×</button>
   {person&&company?<><span className={styles.kicker}>{company.name}</span><h2>{person.desk.name}</h2><small>{person.desk.human?'Human teammate':TEAM[person.desk.role].name}{person.desk.specialty?` · ${person.desk.specialty}`:''}</small>{!person.desk.human&&<><p>{person.desk.says??(person.desk.state==='away'?'No assigned work':'Available for work')}</p><small>{actor?.arrived?actor.destination.label:`Walking to ${actor?.destination.label??'their desk'}`}</small></>}
    {!person.desk.human&&<><button type="button" className={styles.primary} onClick={()=>onOpenDesk(company,person.desk)}>Open assigned work{person.desk.waiting?` · ${person.desk.waiting} to review`:''} ↗</button>
    <button type="button" onClick={()=>onOpenRoom(company)}>Company & data</button></>}
    {person.desk.human&&<><strong>Virtual employees reporting here</strong>{person.desk.reports?.length?person.desk.reports.map(r=><button key={r.companyId+(r.instanceId??r.role)} onClick={()=>{const room=rooms.find(c=>c.companyId===r.companyId),desk=room?.desks.find(d=>d.role===r.role&&d.instanceId===r.instanceId);if(room&&desk)onOpenDesk(room,desk);}}>{r.name}<small>{r.companyName} · {TEAM[r.role].name}</small></button>):<small>No virtual employees assigned yet. Assign a human contact from a company’s Team panel.</small>}</>}
    {!person.desk.human&&person.desk.state!=='working'&&<><label>Visit a shared space<select aria-label="Send member to amenity" disabled={shared.saving} value="" onChange={e=>void visit(person.id,e.target.value as Amenity)}><option value="">Choose an activity</option>{Object.entries(AMENITIES).map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label><button type="button" disabled={shared.saving} onClick={()=>void visit(person.id,'desk')}>Return to desk</button></>}
   </>:company?<><span className={styles.kicker}>{company.kind==='management'?'Human team':company.relationship==='client'?'Client studio':'Our company'}</span><h2>{company.name}</h2>{company.kind==='management'&&<ManagementEmployees onRemoved={()=>{}}/>}<p>{company.kind==='management'?`${company.desks.length} human teammates. Select a person to see their virtual employees.`:company.waiting?`${company.waiting} items need your review`:company.working?`${company.working} team members working`:'Team available'}</p><div className={styles.metrics}>{company.screens.map(s=><div key={s.label}><b>{s.value}</b><small>{s.label} · 7 days</small></div>)}</div>{company.kind!=='management'&&<button type="button" className={styles.primary} onClick={()=>onOpenRoom(company)}>Open company ↗</button>}<div className={styles.team}>{company.desks.map(d=><button type="button" key={d.employeeId??d.instanceId??d.role} onClick={()=>{const p=world.people.find(p=>p.room.companyId===company.companyId&&(d.human?p.desk.employeeId===d.employeeId:p.desk.role===d.role&&p.desk.instanceId===d.instanceId));if(p)setSelection({kind:'person',id:p.id});else onOpenDesk(company,d);}}><strong>{d.name}</strong><small>{d.says??`${d.jobs} assignments · ${d.state}`}</small></button>)}</div></>:amenity?<><span className={styles.kicker}>The commons</span><h2>{AMENITIES[amenity].name}</h2><p>Shared by every company. Activities here are ambient and do not change assigned work.</p><OfficeRecreation amenity={amenity} shared={shared} motion={motion}/><small>{AMENITIES[amenity].capacity} places · working members stay on task</small><label>Invite an available member<select aria-label="Choose available member" disabled={shared.saving} value="" onChange={e=>void visit(e.target.value,amenity)}><option value="">Choose a team member</option>{world.people.filter(p=>!p.desk.human&&p.desk.state!=='working').map(p=><option key={p.id} value={p.id}>{p.room.name} · {p.desk.name}</option>)}</select></label><ul>{shared.frame?.snapshot.scene.actors.filter(a=>a.destination.amenity===amenity||(['couch','gaming'].includes(amenity)&&['couch','gaming'].includes(a.destination.amenity??''))).map(a=>{const p=world.people.find(p=>p.id===a.id);return p&&<li key={a.id}><button type="button" onClick={()=>setSelection({kind:'person',id:a.id})}>{p.room.name} · {p.desk.name}<small>{a.arrived?'Here':'Walking over'}</small></button></li>;})}</ul></>:null}
   {company?.kind==='management'&&person?.desk.employeeId&&<ManagementEmployees key={person.desk.employeeId} employeeId={person.desk.employeeId} onRemoved={()=>setSelection({kind:'company',id:'management'})}/>}
   {shared.error&&<p role="alert">{shared.error}</p>}
  </aside>}
  <div className={styles.bottom}>
   <div className={styles.navigation}><button type="button" aria-label="Zoom out" onClick={()=>game.current?.zoom(1/1.2)}>−</button><output>{Math.round((view?.camera.zoom??1)*100)}%</output><button type="button" aria-label="Zoom in" onClick={()=>game.current?.zoom(1.2)}>+</button><button type="button" onClick={()=>game.current?.fit()}>Whole office</button><button type="button" onClick={()=>void fullscreen()} aria-label="Toggle full screen">⛶</button><button type="button" aria-pressed={!motion} onClick={()=>setMotion(!motion)}>{motion?'Pause animation':motionOverride===null?'Enable animation':'Animate'}</button></div>
   <span className={styles.help}>Drag to explore · scroll / pinch to zoom · click to interact</span>
  </div>
  {shared.error&&!selection&&<p role="status" className={styles.error}>{shared.error}</p>}
  {fullError&&<p role="alert" className={styles.error}>{fullError}</p>}
 </div>;
}
