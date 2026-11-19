'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Desk, Room } from './officeState';
import { AMENITIES, type Amenity } from './officeActivities';
import { AMENITY_POSITION, makeWorld, officeTheme, type Person } from './officeSimulation';
import { useOfficeWorld } from './useOfficeWorld';
import { useOfficeMotion } from './useOfficeMotion';
import styles from './World.module.css';

function Art({src,className,style}:{src:string;className?:string;style?:CSSProperties}) {
    // eslint-disable-next-line @next/next/no-img-element -- original lightweight transparent sprite
    return <img src={src} alt="" draggable={false} loading="lazy" decoding="async" className={className} style={style} />;
}
function Logo({room}:{room:Room}) {
    const [failed,setFailed]=useState(false);
    if(room.logo&&!failed) {
        // eslint-disable-next-line @next/next/no-img-element -- existing company-provided branding
        return <img src={room.logo} alt="" onError={()=>setFailed(true)} loading="lazy" />;
    }
    return <span className={styles.monogram}>{room.name.slice(0,2).toUpperCase()}</span>;
}
const DECOR:Record<string,string>={controller:'🎮',trophy:'🏆',arcade:'🕹',chart:'📈',globe:'🌐',safe:'🔐',camera:'📷',palette:'🎨',books:'📚',house:'🏠',tools:'🛠',plant:'🪴',laptop:'💻',mail:'✉'};

export default function OfficeWorld({rooms,onOpenRoom,onOpenDesk}:{rooms:Room[];onOpenRoom:(room:Room)=>void;onOpenDesk:(room:Room,desk:Desk)=>void}) {
    const world=useMemo(()=>makeWorld(rooms),[rooms]);
    const clientWingEnd=Math.max(665,...world.suites.filter(s=>s.room.relationship==='client').map(s=>s.y+s.h));
    const viewport=useRef<HTMLDivElement>(null);
    const [zoom,setZoom]=useState<number|null>(null);
    const [fit,setFit]=useState(1);
    const [selected,setSelected]=useState<Person|null>(null);
    const [amenity,setAmenity]=useState<Amenity|null>(null);
    const [overrides,setOverrides]=useState<Record<string,Amenity|'desk'>>({});
    const [ambient,setAmbient]=useState(true);
    const {ref,enabled}=useOfficeMotion();
    const scale=zoom??fit;
    useEffect(()=>{
        const element=viewport.current;if(!element)return;
        const observer=new ResizeObserver(([entry])=>setFit(Math.min(1,Math.max(.55,entry.contentRect.width/1280))));
        observer.observe(element);return()=>observer.disconnect();
    },[]);
    const {nodes,snapshot}=useOfficeWorld(world,enabled&&ambient,overrides);
    const selectedLive=selected?world.people.find(p=>p.id===selected.id):null;
    const counts=new Map<Amenity,number>();
    for(const actor of snapshot) if(actor.arrived&&actor.destination.amenity) counts.set(actor.destination.amenity,(counts.get(actor.destination.amenity)??0)+1);
    const visit=(person:Person,target:Amenity|'desk')=>{setOverrides(current=>({...current,[person.id]:target}));setSelected(null);};
    return <div className={styles.wrapper} ref={ref}>
        <div className={styles.toolbar}>
            <div><strong>Office floor</strong><small>Live work at desks · amber needs you · breaks are ambient</small></div>
            <label>Go to <select aria-label="Go to company" defaultValue="" onChange={event=>{
                const suite=world.suites.find(s=>s.room.companyId===event.target.value);
                if(suite) viewport.current?.scrollTo({top:Math.max(0,suite.y*scale-20),left:Math.max(0,(suite.x-10)*scale),behavior:'smooth'});
            }}><option value="">Choose company</option>{rooms.map(room=><option value={room.companyId} key={room.companyId}>{room.name}</option>)}</select></label>
            <button type="button" aria-label="Zoom out" onClick={()=>setZoom(Math.max(.1,scale-.1))}>−</button><span>{Math.round(scale*100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={()=>setZoom(Math.min(1.5,scale+.1))}>+</button>
            <button type="button" onClick={()=>setZoom(null)}>Fit width</button>
            <button type="button" onClick={()=>{setZoom(Math.min(fit,(viewport.current?.clientHeight??700)/world.height));viewport.current?.scrollTo({top:0,left:0});}}>Whole office</button>
            <button type="button" aria-pressed={!ambient} onClick={()=>setAmbient(v=>!v)}>{ambient?'Pause motion':'Resume motion'}</button>
        </div>
        <div className={styles.workStrip} aria-label="Live office work">
            {rooms.filter(room=>room.waiting||room.working).map(room=><button key={room.companyId} type="button" onClick={()=>onOpenRoom(room)}><i style={{background:room.waiting?'#eab65d':room.color}}/><strong>{room.name}</strong><span>{room.waiting?`${room.waiting} need you`: `${room.working} working`}</span><small>{(room.desks.find(d=>d.waiting&&d.says)??room.desks.find(d=>d.says))?.says}</small></button>)}
            {!rooms.some(room=>room.waiting||room.working)&&<span>No work running or waiting for review. Select a company to assign work.</span>}
        </div>
        {(selectedLive||amenity)&&<div className={styles.inspector}>
            <button type="button" className={styles.close} onClick={()=>{setSelected(null);setAmenity(null);}}>Close</button>
            {selectedLive ? <><strong>{selectedLive.room.name} · {selectedLive.desk.name}</strong><p>{selectedLive.desk.says??'Available for work'}</p>
                <button type="button" onClick={()=>onOpenDesk(selectedLive.room,selectedLive.desk)}>Open assigned work{selectedLive.desk.waiting?` · ${selectedLive.desk.waiting} to review`:''}</button>
                <button type="button" onClick={()=>onOpenRoom(selectedLive.room)}>Company & data</button>
                {!['waiting','working'].includes(selectedLive.desk.state)&&<><button type="button" onClick={()=>visit(selectedLive,'desk')}>Return to desk</button><label>Visit <select aria-label="Send member to amenity" value="" onChange={event=>visit(selectedLive,event.target.value as Amenity)}><option value="">Choose a shared space</option>{Object.entries(AMENITIES).map(([id,value])=><option key={id} value={id}>{value.name}</option>)}</select></label></>}
            </> : amenity && <><strong>{AMENITIES[amenity].name}</strong><p>{counts.get(amenity)??0} members here. Select an available member to join.</p>
                <select aria-label="Choose available member" value="" onChange={event=>{const person=world.people.find(p=>p.id===event.target.value);if(person)visit(person,amenity);}}><option value="">Choose a team member</option>{world.people.filter(p=>p.desk.state==='idle'||p.desk.state==='away').map(p=><option key={p.id} value={p.id}>{p.room.name} · {p.desk.name}</option>)}</select>
            </>}
        </div>}
        <div ref={viewport} className={styles.viewport} aria-label="Scrollable office floor">
            <div style={{width:world.width*scale,height:world.height*scale,margin:'0 auto'}}>
                <div className={styles.world} data-motion={enabled&&ambient} style={{width:world.width,height:world.height,transform:`scale(${scale})`}}>
                    <div className={styles.outerWall} />
                    <div className={styles.daylight} />
                    <div className={styles.meeting}><div className={styles.sharedLabel}>MEETING ROOM</div><div className={styles.glass}/><div className={styles.sharedWindows}/><div className={styles.meetingDoor}/></div>
                    <div className={styles.recreation}><div className={styles.sharedLabel}>THE COMMONS</div><div className={styles.sharedWindows}/><div className={styles.recDoor}/></div>
                    <div className={styles.hallRunner} style={{height:world.height-590}}/>
                    <div className={styles.lobbyFloor} aria-hidden="true"/>
                    <div className={styles.lobbyBench} aria-hidden="true"><i/><i/><i/></div>
                    <Art src="/office/amenities/plant.webp" className={styles.lobbyPlant}/>
                    <div className={styles.lobbyWayfinding} aria-hidden="true"><strong>THE NEIGHBOURHOOD</strong><span>Studios ↓ &nbsp; Commons ↑</span></div>
                    {world.suites.map(suite=><div key={`landing:${suite.room.companyId}`} className={styles.landing} aria-hidden="true" style={{left:suite.x,top:suite.y+suite.h,width:suite.w,'--brand':suite.room.color} as CSSProperties}>
                        <div className={styles.galleryRail}><i/><i/><i/></div><div className={styles.landingLight}/>
                    </div>)}
                    {Array.from({length:Math.max(0,Math.floor((world.height-clientWingEnd-110)/340))},(_,index)=><div key={`garden:${index}`} className={styles.gardenNook} aria-hidden="true" style={{top:clientWingEnd+65+index*340}}>
                        <div className={styles.nookWindow}/><span>THE GARDEN LOUNGE</span>
                        <Art src="/office/amenities/couch.webp" className={styles.nookSofa}/>
                        <Art src="/office/amenities/plant.webp" className={styles.nookPlant}/>
                    </div>)}
                    <div className={styles.entry}>NUCLEAS <span>HEADQUARTERS</span></div>
                    <div className={styles.wingLabel} style={{left:35,top:630}}>OUR COMPANIES</div><div className={styles.wingLabel} style={{left:860,top:630}}>CLIENT STUDIOS</div>
                    {Object.entries(AMENITY_POSITION).map(([id,pos])=><button type="button" key={id} className={styles.amenity} style={{left:pos.x-pos.size/2,top:pos.y-pos.size/2,width:pos.size,height:pos.size,zIndex:Math.round(pos.y)+60}}
                        aria-label={`${AMENITIES[id as Amenity].name} · ${counts.get(id as Amenity)??0} members`} onClick={()=>{setSelected(null);setAmenity(id as Amenity);}}>
                        <Art src={`/office/amenities/${id}.webp`}/><span>{AMENITIES[id as Amenity].name}</span>
                        {id==='pool'&&(counts.get('pool')??0)>=2&&<span className={styles.poolAction} aria-hidden="true"><i/><i/><i/></span>}
                        {id==='coffee'&&(counts.get('coffee')??0)>0&&<i className={styles.steam} aria-hidden="true">≈</i>}
                    </button>)}
                    {world.suites.map(suite=>{
                        const theme=officeTheme(suite.room),client=suite.room.relationship==='client';
                        return <section key={suite.room.companyId} className={`${styles.suite} ${client?styles.client:''}`} aria-label={`${suite.room.name} studio`} style={{left:suite.x,top:suite.y,width:suite.w,height:suite.h,'--brand':suite.room.color,'--door':`${suite.door.y-suite.y}px`} as CSSProperties}>
                            <div className={styles.suiteFloor}/><div className={styles.backWall}/><div className={styles.sideWall}/><div className={styles.frontWall}/><div className={styles.doorSwing}/><div className={styles.suiteWindows}/>
                            <button type="button" className={styles.companySign} onClick={()=>onOpenRoom(suite.room)}><Logo room={suite.room}/><span><strong>{suite.room.name}</strong><small>{suite.room.waiting?`${suite.room.waiting} need your review`:suite.room.working?`${suite.room.working} working now`:'Team available'} · Open company ↗</small></span></button>
                            <div className={styles.decor} title={`Décor inspired by ${suite.room.description??suite.room.name}`}><small>{theme.label}</small>{theme.objects.map(object=><span key={object} aria-hidden="true">{DECOR[object]}</span>)}</div>
                            <button type="button" className={styles.metrics} onClick={()=>onOpenRoom(suite.room)} aria-label={`${suite.room.name} metrics`}>{suite.room.screens.length?suite.room.screens.map(screen=><span key={screen.label}><b>{screen.value}</b>{screen.label}</span>):<span>Company data ↗</span>}</button>
                            <Art src="/office/amenities/plant.webp" className={styles.cornerPlant}/>
                        </section>;
                    })}
                    {world.people.map(person=>{
                        const actor=snapshot.find(a=>a.id===person.id);
                        const pose=actor?.arrived?actor.destination.pose:'idle';
                        const client=person.room.relationship==='client';
                        const working=person.desk.state==='working';
                        return <div key={person.id}>
                            <div className={styles.workstation} style={{left:person.home.point.x-(client?65:95),top:person.home.point.y-(client?100:130),width:client?120:155,zIndex:Math.round(person.home.point.y)+20}}>
                                <Art src={`/office/characters/${person.desk.role}-workstation.webp`}/>
                                {working&&<i className={styles.monitorLight}/>}<button type="button" className={`${styles.workLabel} ${person.desk.waiting?styles.attention:''}`} onClick={()=>onOpenDesk(person.room,person.desk)}><strong>{person.desk.name}{person.desk.waiting?` · ${person.desk.waiting} review`:''}</strong><span>{person.desk.says??(person.desk.state==='away'?'No work assigned':'Available')}</span></button>
                            </div>
                            <div className={styles.deskChair} aria-hidden="true" style={{left:person.home.point.x-17,top:person.home.point.y-33,zIndex:Math.round(person.home.point.y)+40}}><i/><b/></div>
                            <button type="button" ref={node=>{if(node)nodes.current.set(person.id,node);else nodes.current.delete(person.id);}} className={styles.actor} data-pose={pose} data-state={person.desk.state} data-collaborating={actor?.destination.collaboration&&actor.arrived}
                                style={{transform:`translate3d(${person.home.point.x-44}px,${person.home.point.y-82}px,0)`,'--phase':`${world.people.indexOf(person)%2?'-3s':'0s'}`} as CSSProperties}
                                aria-label={`${person.room.name} · ${person.desk.name} · ${person.desk.says??actor?.destination.label??'Available'}`} onClick={()=>{setAmenity(null);setSelected(person);}}>
                                <canvas width={256} height={240} aria-hidden="true" className={styles.rigCanvas}/>
                                <Art className={styles.walkSprite} src={`/office/characters/${person.desk.role}-idle.webp`}/>
                                <Art className={styles.poseSprite} src={`/office/characters/${person.desk.role}-${pose==='idle'?'idle':pose}.webp`}/>
                                {person.desk.waiting>0&&<b className={styles.reviewBadge}>{person.desk.waiting}</b>}
                                {actor?.destination.collaboration&&actor.arrived&&<span className={styles.discussion}>•••</span>}
                                <small>{person.desk.name}</small>
                            </button>
                        </div>;
                    })}
                </div>
            </div>
        </div>
    </div>;
}
