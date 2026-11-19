'use client';
import type { TeamRole } from '@/lib/companies/teamRoles';
import type { MemberState } from './officeState';
import { characterArt } from './characters';
import styles from './Office.module.css';

/** Full-body art only. The room owns furniture, movement and permission to animate. */
export default function Character({ role, state, size = 88, walking = false }: { role: TeamRole; state: MemberState; size?: number; walking?: boolean }) {
    const art = characterArt(role, state, walking);
    if (!art) return null;
    // eslint-disable-next-line @next/next/no-img-element -- original local GIF; static WebP when motion is disabled
    return <img src={art} alt="" aria-hidden="true" width={size} height={size} draggable={false} loading="lazy" decoding="async"
        className={`${styles.sprite} ${state === 'away' ? styles.away : ''}`} style={{ width: size, height: size }} />;
}
