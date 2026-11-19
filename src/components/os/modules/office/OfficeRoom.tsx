'use client';

import { useState, type CSSProperties } from 'react';
import Character from './Character';
import { CHARACTER_ROLES } from './characters';
import type { Desk, Room } from './officeState';
import { useOfficeMotion } from './useOfficeMotion';
import { AMENITIES, type OfficeVisit } from './officeActivities';
import styles from './Office.module.css';

const STATE_LABEL = { working: 'Working', waiting: 'Needs you', idle: 'Available', away: 'Unassigned' };

function Person({ room, desk, index, animate, onOpen }: { room: Room; desk: Desk; index: number; animate: boolean; onOpen: (room: Room, desk: Desk) => void }) {
    const [hovered, setHovered] = useState(false);
    const walking = animate && !hovered && desk.state === 'idle';
    const label = `${room.name} · ${desk.name} · ${STATE_LABEL[desk.state]}${desk.says ? `: ${desk.says}` : ''}`;
    const compact = room.relationship === 'client';
    return <div className={styles.personPosition} style={{ left: `${24 + (index % 3) * 29}%`, top: (compact ? 80 : 108) + Math.floor(index / 3) * (compact ? 116 : 170), '--phase': `${-index * 1.3}s` } as CSSProperties}>
        <button type="button" aria-label={label} title={label} onClick={() => onOpen(room, desk)}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}
            className={`${styles.person} ${walking ? styles.strolling : ''}`}>
            <span className={`${styles.personArt} ${walking ? styles.turning : ''}`}><Character role={desk.role} state={desk.state} size={compact ? 64 : 84} walking={walking} /></span>
            {desk.state === 'waiting' && <span className={styles.requestBadge}>{desk.waiting > 1 ? desk.waiting : '!'}</span>}
            <span className={styles.nameplate}><i data-state={desk.state} />{desk.name}</span>
            <span className={styles.personStatus}>{STATE_LABEL[desk.state]}</span>
        </button>
    </div>;
}

/** Company area: room, furniture and people are independent layers with stable positions. */
export default function OfficeRoom({ room, visits = [], onOpenDesk }: { room: Room; visits?: OfficeVisit[]; onOpenDesk: (room: Room, desk: Desk) => void }) {
    const { ref, enabled } = useOfficeMotion();
    return <><div ref={ref} className={styles.roomScene} style={{ '--company-color': room.color } as CSSProperties}>
        <div aria-hidden="true" className={styles.backWall}>
            <div className={styles.window}><span /><span /><span /></div>
            <div className={styles.wallSign}>{room.name}</div>
            <div className={styles.wallLight} />
        </div>
        <div aria-hidden="true" className={styles.roomFloor} />
        <div aria-hidden="true" className={styles.aisle}>{room.relationship === 'client' ? 'CLIENT SUITE' : 'COMPANY STUDIO'}</div>
        {CHARACTER_ROLES.map((role, index) => <div key={role} className={styles.workstation} style={{ left: `${2 + (index % 3) * 31}%`, top: (room.relationship === 'client' ? 48 : 66) + Math.floor(index / 3) * (room.relationship === 'client' ? 116 : 170) }} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- independent original furniture asset */}
            <img src={`/office/characters/${role}-desk.webp`} alt="" width={256} height={256} loading="lazy" decoding="async" draggable={false} />
        </div>)}
        {CHARACTER_ROLES.map((role, index) => {
            const desk = room.desks.find(d => d.role === role);
            const visit = visits.find(visit => visit.role === role);
            if (desk && visit) return <button key={role} type="button" onClick={() => onOpenDesk(room, desk)} className={styles.visitingDesk}
                style={{ left: `${24 + (index % 3) * 29}%`, top: (room.relationship === 'client' ? 108 : 146) + Math.floor(index / 3) * (room.relationship === 'client' ? 116 : 170) }}>
                {desk.name}<small>{AMENITIES[visit.amenity].action}</small>
            </button>;
            return desk ? <Person key={role} room={room} desk={desk} index={index} animate={enabled} onOpen={onOpenDesk} /> : null;
        })}
        <div className={styles.door} aria-hidden="true"><span />COMMON WALKWAY</div>
    </div>
        <div className={styles.mobileRoster} aria-label={`${room.name} team`}>
            {CHARACTER_ROLES.map(role => {
                const desk = room.desks.find(desk => desk.role === role);
                if (!desk) return null;
                const visit = visits.find(visit => visit.role === role);
                return <button key={role} type="button" onClick={() => onOpenDesk(room, desk)} className={styles.mobileMember}>
                    <Character role={role} state={desk.state} size={room.relationship === 'client' ? 48 : 64} />
                    <span><strong>{desk.name}</strong><small>{visit ? AMENITIES[visit.amenity].action : STATE_LABEL[desk.state]}</small>{desk.waiting > 0 && <small className={styles.mobileAttention}>{desk.waiting} to review</small>}</span>
                </button>;
            })}
        </div>
    </>;
}
