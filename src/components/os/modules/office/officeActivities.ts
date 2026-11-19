import type { TeamRole } from '@/lib/companies/teamRoles';
import type { Room } from './officeState';

export const AMENITIES = {
    conference: { name: 'Meeting table', action: 'Meeting', capacity: 6 },
    projector: { name: 'Projector', action: 'Presenting', capacity: 1 },
    couch: { name: 'Couch', action: 'Relaxing', capacity: 2 },
    coffee: { name: 'Coffee bar', action: 'Making coffee', capacity: 1 },
    water: { name: 'Water cooler', action: 'Getting water', capacity: 1 },
    plant: { name: 'Plants', action: 'Tending plants', capacity: 1 },
    pool: { name: 'Pool table', action: 'Playing pool', capacity: 2 },
    gaming: { name: 'TV & game console', action: 'Playing a game', capacity: 2 },
    reception: { name: 'Reception', action: 'At reception', capacity: 1 },
} as const;
export type Amenity = keyof typeof AMENITIES;
export type OfficeVisit = { companyId: string; role: TeamRole; amenity: Amenity };
export function validVisits(visits: OfficeVisit[], rooms: Room[]) {
    return visits.filter(visit => {
        const desk = rooms.find(room => room.companyId === visit.companyId)?.desks.find(desk => desk.role === visit.role);
        return desk && (desk.state === 'idle' || desk.state === 'away');
    });
}
