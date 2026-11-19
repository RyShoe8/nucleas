import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CHARACTER_ROLES, characterArt } from './characters';

describe('production office characters', () => {
    it('has transparent, bounded-size art and four walking frames for every active member', async () => {
        let total = 0;
        for (const role of CHARACTER_ROLES) {
            for (const suffix of ['idle.webp', 'walking.gif', 'desk.webp']) {
                const buffer = await readFile(path.join(process.cwd(), 'public/office/characters', `${role}-${suffix}`));
                total += buffer.length;
                const meta = await sharp(buffer, { animated: true }).metadata();
                expect(meta.hasAlpha).toBe(true);
                expect(meta.width).toBe(suffix === 'desk.webp' ? 256 : 192);
                if (suffix === 'walking.gif') {
                    expect(meta.pages).toBe(4);
                    expect(meta.pageHeight).toBe(192);
                    expect(meta.delay).toEqual([180, 180, 180, 180]);
                    expect(meta.loop).toBe(0);
                }
                const stats = await sharp(buffer).stats();
                expect(stats.channels[3].min).toBe(0);
                expect(stats.channels[3].max).toBeGreaterThan(240);
            }
        }
        expect(total).toBeLessThan(600_000);
    });

    it('uses static art unless movement is explicitly enabled, independent of work status', () => {
        for (const role of CHARACTER_ROLES) {
            for (const state of ['working', 'waiting', 'idle', 'away'] as const) {
                expect(characterArt(role, state)).toBe(`/office/characters/${role}-idle.webp`);
            }
            expect(characterArt(role, 'idle', true)).toBe(`/office/characters/${role}-walking.gif`);
        }
        expect(characterArt('tester', 'away')).toBeNull();
    });
});
