'use client';

import type { TeamRole } from '@/lib/companies/teamRoles';
import type { MemberState } from './officeState';
import { PLACEHOLDER_LOOK, characterArt } from './characters';
import styles from './Office.module.css';

/**
 * A team member at their desk. Uses the member's own art when it has been added (characters.ts);
 * until then a small pixel placeholder, animated by state: typing, waving for you, resting, or away.
 */
export default function Character({ role, state, size = 56 }: { role: TeamRole; state: MemberState; size?: number }) {
    const art = characterArt(role, state);
    if (art) {
        // eslint-disable-next-line @next/next/no-img-element -- local character art, often animated GIFs
        return <img src={art} alt="" width={size} height={size} className={`${styles.sprite} ${state === 'away' ? styles.away : ''}`} style={{ width: size, height: size, objectFit: 'contain' }} />;
    }
    const look = PLACEHOLDER_LOOK[role];
    return (
        <svg viewBox="0 0 28 32" width={size} height={size * (32 / 28)} aria-hidden="true" className={`${styles.sprite} ${styles[state]}`}>
            <g className={styles.body}>
                {/* chair back */}
                <rect x="6" y="12" width="16" height="12" rx="1" fill="#2a3142" />
                {/* torso */}
                <rect x="8" y="14" width="12" height="9" fill={look.shirt} />
                {look.extra === 'tie' ? <rect x="13" y="14" width="2" height="6" fill="#A32D2D" /> : null}
                {/* head */}
                <rect x="9" y="5" width="10" height="9" fill={look.skin} />
                <rect x="8" y="3" width="12" height="4" fill={look.hair} />
                <rect x="8" y="6" width="2" height="4" fill={look.hair} />
                <rect x="11" y="9" width="2" height="2" fill="#2C2C2A" />
                <rect x="15" y="9" width="2" height="2" fill="#2C2C2A" />
                {look.extra === 'glasses' ? <><rect x="10" y="8" width="4" height="4" fill="none" stroke="#2C2C2A" strokeWidth="0.8" /><rect x="14" y="8" width="4" height="4" fill="none" stroke="#2C2C2A" strokeWidth="0.8" /></> : null}
                {look.extra === 'headset' ? <><rect x="7" y="7" width="2" height="4" fill="#2C2C2A" /><rect x="7" y="2" width="14" height="1.5" fill="#2C2C2A" /><rect x="7" y="11" width="4" height="1" fill="#2C2C2A" /></> : null}
                {look.extra === 'beret' ? <rect x="7" y="1" width="12" height="3" rx="1.5" fill="#A32D2D" /> : null}
            </g>
            {/* waving arm (only animates while waiting) */}
            <rect className={styles.arm} x="19" y="13" width="3" height="6" fill={look.shirt} />
            {look.extra === 'clipboard' ? <rect x="20" y="17" width="4" height="5" fill="#B4B2A9" /> : null}
            {/* desk and monitor */}
            <rect x="1" y="23" width="26" height="3" fill="#6b4f3a" />
            <rect x="3" y="26" width="2" height="6" fill="#4a3628" />
            <rect x="23" y="26" width="2" height="6" fill="#4a3628" />
            <rect x="5" y="16" width="9" height="7" fill="#1f2430" />
            <rect className={styles.screenGlow} x="6" y="17" width="7" height="5" fill={state === 'working' ? '#5DCAA5' : state === 'waiting' ? '#EF9F27' : '#444c5c'} />
            <rect x="9" y="23" width="1" height="0" fill="#1f2430" />
        </svg>
    );
}
