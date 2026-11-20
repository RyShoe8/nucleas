'use client';
import {useState,type ReactNode} from 'react';
import type {Desk,Room} from './officeState';
import type {OfficeVisit} from './officeActivities';
import OfficeWorld from './OfficeWorld';
import {useSharedOffice} from './useSharedOffice';
import styles from './Office.module.css';

export default function OfficeBuilding(props:{rooms:Room[];renderRoom:(room:Room,visits:OfficeVisit[])=>ReactNode;onOpenDesk:(room:Room,desk:Desk)=>void;onOpenRoom:(room:Room)=>void}) {
    const [view,setView]=useState<'floor'|'list'>('floor');
    const shared=useSharedOffice();
    const rooms=shared.frame?.snapshot.scene.world.suites.map(s=>s.room)??props.rooms;
    const visits:OfficeVisit[]=(shared.frame?.snapshot.scene.actors??[]).flatMap(actor=>{
        const person=shared.frame?.snapshot.scene.world.people.find(p=>p.id===actor.id);
        return person&&actor.destination.amenity?[{companyId:person.room.companyId,role:person.desk.role,amenity:actor.destination.amenity}]:[];
    });
    return <><div className="mb-2 flex gap-2" role="group" aria-label="Office view">
        <button type="button" className="ui-button min-h-11" aria-pressed={view==='floor'} onClick={()=>setView('floor')}>Live office</button>
        <button type="button" className="ui-button min-h-11" aria-pressed={view==='list'} onClick={()=>setView('list')}>Company list</button>
    </div>{view==='floor'?<OfficeWorld rooms={rooms} shared={shared} onOpenRoom={props.onOpenRoom} onOpenDesk={props.onOpenDesk}/>:<>
        <p className="mb-3 text-sm text-text-secondary" role="status">{shared.error??(shared.frame?'Same organization office · use Live office to visit shared spaces':'Connecting to your organization office…')}</p>
        <div className={styles.wings}>{(['owned','client'] as const).map(wing=><section key={wing} aria-label={wing==='owned'?'Our companies':'Clients'}><h3 className="mb-3 font-semibold">{wing==='owned'?'Our companies':'Clients'}</h3><div className={styles.studioGrid}>{rooms.filter(r=>wing==='client'?r.relationship==='client':r.relationship!=='client').map(room=>props.renderRoom(room,visits.filter(v=>v.companyId===room.companyId)))}</div></section>)}</div>
    </>}</>;
}
