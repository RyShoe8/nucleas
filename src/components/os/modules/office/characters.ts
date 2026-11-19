import type { TeamRole } from '@/lib/companies/teamRoles';
import type { MemberState } from './officeState';

export const CHARACTER_ROLES = ['design', 'creative', 'engineering', 'support', 'operations', 'marketing'] as const;
/** Characters are independent of furniture and business status. Tester remains unstaffed. */
export const CHARACTER_ART = Object.fromEntries(CHARACTER_ROLES.map(role => [role, {
    idle: `/office/characters/${role}-idle.webp`,
    walking: `/office/characters/${role}-walking.gif`,
}])) as Record<typeof CHARACTER_ROLES[number], { idle: string; walking: string }>;

export function characterArt(role: TeamRole, _state: MemberState, walking = false): string | null {
    if (role === 'tester') return null;
    return walking ? CHARACTER_ART[role].walking : CHARACTER_ART[role].idle;
}
