'use client';
import type {Desk,Room} from './officeState';
import OfficeWorld from './OfficeWorld';
import {useSharedOffice} from './useSharedOffice';
import {useWindowManager} from '@/hooks/os/useWindowManager';

export default function OfficeBuilding(props:{onOpenDesk:(room:Room,desk:Desk)=>void;onOpenRoom:(room:Room)=>void}) {
    const shared=useSharedOffice(),wm=useWindowManager();
    if(!shared.frame)return <p className="p-4 text-sm text-text-secondary" role="status">{shared.error??'Connecting to your organization office…'}</p>;
    const rooms=shared.frame.snapshot.scene.world.suites.map(s=>s.room);
    if(!rooms.length)return <div className="ui-panel space-y-3 p-4"><p>Your office is empty.</p><button type="button" className="ui-button" onClick={()=>wm.open('companies')}>Add a company</button></div>;
    return <OfficeWorld rooms={rooms} shared={shared} onOpenRoom={props.onOpenRoom} onOpenDesk={props.onOpenDesk}/>;
}
