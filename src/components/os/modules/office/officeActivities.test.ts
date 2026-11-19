import { describe, expect, it } from 'vitest';
import { AMENITIES, validVisits, type OfficeVisit } from './officeActivities';
import { buildOffice } from './officeState';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

describe('shared office activities', () => {
    it('returns members to their desks when real work or a review needs them', () => {
        const rooms = buildOffice({ companies: [{ id: 'owned', name: 'Company', relationship: 'owned' }, { id: 'client', name: 'Client', relationship: 'client' }], jobs: [], activity: [], today: [] });
        const visits: OfficeVisit[] = [
            { companyId: 'owned', role: 'design', amenity: 'pool' },
            { companyId: 'client', role: 'marketing', amenity: 'gaming' },
        ];
        expect(validVisits(visits, rooms)).toHaveLength(2);
        rooms.find(r => r.companyId === 'owned')!.desks.find(d => d.role === 'design')!.state = 'working';
        expect(validVisits(visits, rooms)).toEqual([visits[1]]);
        rooms.find(r => r.companyId === 'client')!.desks.find(d => d.role === 'marketing')!.state = 'waiting';
        expect(validVisits(visits, rooms)).toEqual([]);
        expect(validVisits(visits, [])).toEqual([]);
    });
    it('ships small transparent furnishings for every selectable amenity', async () => {
        let total = 0;
        for (const name of Object.keys(AMENITIES)) {
            const buffer = await readFile(path.join(process.cwd(), 'public/office/amenities', `${name}.webp`));
            const metadata = await sharp(buffer).metadata();
            expect(metadata).toMatchObject({ width: 384, height: 384, hasAlpha: true });
            total += buffer.length;
        }
        expect(total).toBeLessThan(400_000);
    });
});
