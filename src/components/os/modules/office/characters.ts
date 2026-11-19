import type { TeamRole } from '@/lib/companies/teamRoles';
import type { MemberState } from './officeState';

/**
 * Character art for the office. Drop animated GIFs (or PNG/WebP) into public/office/characters/ and list
 * them here; a team member without art for a state uses its art for 'idle', then the built-in placeholder.
 * See public/office/characters/README.md for the sizes and states.
 */
export const CHARACTER_ART: Partial<Record<TeamRole, Partial<Record<MemberState, string>>>> = {
    // marketing: { working: '/office/characters/marketing-working.gif', waiting: '/office/characters/marketing-waiting.gif', idle: '/office/characters/marketing-idle.gif', away: '/office/characters/marketing-away.gif' },
};

export function characterArt(role: TeamRole, state: MemberState): string | null {
    const art = CHARACTER_ART[role];
    return art?.[state] ?? art?.idle ?? null;
}

/** Placeholder looks, one per member, so each is recognisable before real art arrives. */
export const PLACEHOLDER_LOOK: Record<TeamRole, { shirt: string; hair: string; skin: string; extra: 'glasses' | 'headset' | 'beret' | 'tie' | 'clipboard' | 'none' }> = {
    marketing: { shirt: '#378ADD', hair: '#3C3489', skin: '#E8B98A', extra: 'tie' },
    engineering: { shirt: '#1D9E75', hair: '#2C2C2A', skin: '#C68B5E', extra: 'glasses' },
    design: { shirt: '#7F77DD', hair: '#993556', skin: '#F1C9A5', extra: 'none' },
    creative: { shirt: '#D85A30', hair: '#BA7517', skin: '#E8B98A', extra: 'beret' },
    support: { shirt: '#D4537E', hair: '#444441', skin: '#8D5A3B', extra: 'headset' },
    operations: { shirt: '#5F5E5A', hair: '#888780', skin: '#F1C9A5', extra: 'clipboard' },
    tester: { shirt: '#888780', hair: '#444441', skin: '#E8B98A', extra: 'none' },
};
