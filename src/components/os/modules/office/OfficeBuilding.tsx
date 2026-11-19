'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Desk, Room } from './officeState';
import Character from './Character';
import { useOfficeMotion } from './useOfficeMotion';
import styles from './Office.module.css';
import { AMENITIES, validVisits, type Amenity, type OfficeVisit } from './officeActivities';
const keyOf = (companyId: string, role: string) => `${companyId}:${role}`;


function Visitor({ room, desk, amenity, animate, onReturn }: { room: Room; desk: Desk; amenity: Amenity; animate: boolean; onReturn: () => void }) {
    const [arriving, setArriving] = useState(true);
    return <button type="button" className={`${styles.visitor} ${arriving && animate ? styles.arriving : ''}`} onAnimationEnd={() => setArriving(false)} onClick={onReturn}
        title={`${room.name} · ${desk.name} · ${AMENITIES[amenity].action}. Return to desk.`} aria-label={`Return ${room.name} ${desk.name} to their desk`}>
        <Character role={desk.role} state="idle" size={96} walking={arriving && animate} />
        <span>{desk.name}</span>
    </button>;
}

export default function OfficeBuilding({ rooms, renderRoom, onOpenDesk }: {
    rooms: Room[];
    renderRoom: (room: Room, visits: OfficeVisit[]) => ReactNode;
    onOpenDesk: (room: Room, desk: Desk) => void;
}) {
    const [visits, setVisits] = useState<OfficeVisit[]>([]);
    const [selected, setSelected] = useState<Amenity | null>(null);
    const [selectedCompany, setSelectedCompany] = useState('');
    const activityPanel = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!selected) return;
        activityPanel.current?.focus({ preventScroll: true });
        activityPanel.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);
    const { ref, enabled } = useOfficeMotion();
    const active = validVisits(visits, rooms);
    // If real work starts, return the member permanently rather than reviving a stale visit later.
    if (active.length !== visits.length) setVisits(active);
    const owned = rooms.filter(room => room.relationship !== 'client');
    const clients = rooms.filter(room => room.relationship === 'client');
    const company = rooms.find(room => room.companyId === selectedCompany) ?? rooms[0];
    const returnToDesk = (visit: OfficeVisit) => setVisits(current => current.filter(item => keyOf(item.companyId, item.role) !== keyOf(visit.companyId, visit.role)));
    const send = (room: Room, desk: Desk) => {
        if (!selected || !['idle', 'away'].includes(desk.state)) return;
        setVisits(current => {
            const remaining = validVisits(current, rooms).filter(visit => keyOf(visit.companyId, visit.role) !== keyOf(room.companyId, desk.role));
            if (remaining.filter(visit => visit.amenity === selected).length >= AMENITIES[selected].capacity) return current;
            return [...remaining, { companyId: room.companyId, role: desk.role, amenity: selected }];
        });
    };
    const amenity = (id: Amenity) => {
        const occupants = active.filter(visit => visit.amenity === id);
        return <div className={`${styles.amenity} ${styles[`amenity_${id}`]} ${occupants.length && enabled ? styles.amenityActive : ''}`}>
            <button type="button" className={styles.amenityButton} onClick={() => setSelected(id)} aria-label={`${AMENITIES[id].name}${occupants.length ? ` · ${occupants.length} using it` : ' · choose a team member'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small original static furnishings */}
                <img src={`/office/amenities/${id}.webp`} alt="" width={384} height={384} loading="lazy" decoding="async" draggable={false} />
                <span className={styles.amenityName}>{AMENITIES[id].name}</span>
                {occupants.length > 0 && <span aria-hidden="true" className={styles.activityEffect}>{id === 'pool' ? '●' : id === 'water' ? '◌' : id === 'coffee' ? '≈' : id === 'gaming' ? '✦' : '•'}</span>}
            </button>
            <div className={styles.visitors}>{occupants.map(visit => {
                const room = rooms.find(room => room.companyId === visit.companyId)!;
                const desk = room.desks.find(desk => desk.role === visit.role)!;
                return <Visitor key={`${keyOf(visit.companyId, visit.role)}:${id}`} room={room} desk={desk} amenity={id} animate={enabled} onReturn={() => returnToDesk(visit)} />;
            })}</div>
        </div>;
    };
    return <div className={styles.building}>
        <div className={styles.buildingHeader}><div><span>NUCLEAS / HEADQUARTERS</span><h2>The office</h2></div><span>{owned.length} compan{owned.length === 1 ? 'y' : 'ies'} · {clients.length} client{clients.length === 1 ? '' : 's'}</span></div>
        <div ref={ref}>
            <div className={styles.commonRooms}>
                <section className={styles.meetingRoom} aria-label="Shared meeting room">
                    <span className={styles.roomCaption}>01 / MEETING ROOM</span>
                    {amenity('projector')}{amenity('conference')}
                    <div className={styles.sharedDoor}>CORRIDOR</div>
                </section>
                <section className={styles.breakRoom} aria-label="Shared break room">
                    <span className={styles.roomCaption}>02 / THE COMMONS · BREAK ROOM</span>
                    {amenity('coffee')}{amenity('water')}{amenity('plant')}{amenity('pool')}{amenity('gaming')}{amenity('couch')}
                    <div className={styles.sharedDoor}>CORRIDOR</div>
                </section>
            </div>
            <div className={styles.mainCorridor}><span>COMPANY WING</span>{amenity('reception')}<span>CLIENT WING</span></div>
        </div>
        {selected && <section ref={activityPanel} tabIndex={-1} className={styles.activityPanel} aria-label={`${AMENITIES[selected].name} activity`}>
            <div className={styles.activityHeading}><strong>{AMENITIES[selected].name}</strong><button type="button" onClick={() => setSelected(null)}>Close</button></div>
            <p>Choose an available team member. Office activities leave their work assignments unchanged.</p>
            {active.filter(visit => visit.amenity === selected).map(visit => {
                const room = rooms.find(room => room.companyId === visit.companyId)!;
                const desk = room.desks.find(desk => desk.role === visit.role)!;
                return <div key={keyOf(visit.companyId, visit.role)} className={styles.activityMember}>
                    <span>{room.name} · {desk.name} · {AMENITIES[selected].action}</span>
                    <button type="button" onClick={() => onOpenDesk(room, desk)}>View work</button>
                    <button type="button" onClick={() => returnToDesk(visit)}>Return to desk</button>
                </div>;
            })}
            <label className={styles.companySelect}>Company <select value={company?.companyId ?? ''} onChange={event => setSelectedCompany(event.target.value)}>
                {rooms.map(room => <option key={room.companyId} value={room.companyId}>{room.name}</option>)}
            </select></label>
            <div className={styles.activityChoices}>{company?.desks.map(desk => {
                const here = active.some(visit => visit.companyId === company.companyId && visit.role === desk.role && visit.amenity === selected);
                const busy = desk.state === 'working' || desk.state === 'waiting';
                const full = active.filter(visit => visit.amenity === selected).length >= AMENITIES[selected].capacity;
                return <button type="button" key={desk.role} disabled={busy || here || full} onClick={() => send(company, desk)}>
                    {desk.name}<small>{here ? 'Already here' : busy ? desk.state === 'waiting' ? 'Needs your review' : 'Working' : full ? 'Space is full' : 'Join here'}</small>
                </button>;
            })}</div>
        </section>}
        <div className={`${styles.wings} ${!owned.length || !clients.length ? styles.singleWing : ''}`}>
            {owned.length > 0 && <section className={styles.companyWing} aria-label="Our companies">
                <div className={styles.wingSign}><h3>Our companies</h3><span>{owned.length} studios</span></div>
                <div className={styles.studioGrid}>{owned.map(room => renderRoom(room, active.filter(visit => visit.companyId === room.companyId)))}</div>
            </section>}
            {clients.length > 0 && <section className={styles.clientWing} aria-label="Clients">
                <div className={styles.wingSign}><h3>Clients</h3><span>{clients.length} suites</span></div>
                <div className={styles.suiteGrid}>{clients.map(room => renderRoom(room, active.filter(visit => visit.companyId === room.companyId)))}</div>
            </section>}
        </div>
        <div className={styles.entryHall}><span>MAIN ENTRANCE</span><i /><i /></div>
    </div>;
}
