import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOsVoiceIntent, executeOsVoiceIntent } from './osVoiceIntent';
import { parseIntentWithContext } from './parseIntentApi';
import { buildOsVoiceContext } from '@/components/os/voice/buildOsVoiceContext';

const hearth = { id: 'hearth', name: 'Hearth', domain: 'hearth.com' };
const playbound = { id: 'playbound', name: 'Playbound.club', domain: 'playbound.club' };
const context = buildOsVoiceContext({ openModuleIds: ['company'], focusedModuleId: 'company', focusedWindowId: '1' }, { moduleId: 'company', companyId: 'hearth', companyName: 'Hearth', section: 'overview' });
const deps = () => ({ companies: vi.fn(async () => [hearth, playbound]), open: vi.fn(), ask: vi.fn() });
afterEach(() => vi.unstubAllGlobals());
describe('OS voice and palette share workspace routing', () => {
    it.each([
        ['open office', 'office', {}], ['show me all jobs', 'work', {}], ['open inbox', 'attention', { companyId: 'hearth' }],
        ['open screenshot', 'tools', { tool: 'screenshot' }], ['open screen recorder', 'tools', { tool: 'recording' }],
        ['open recent captures', 'tools', { tool: 'recent' }], ['open marketing', 'marketing', { companyId: 'hearth' }],
        ['open brand voice', 'brand-voice', { companyId: 'hearth' }], ['give work', 'work', { create: '1', companyId: 'hearth' }],
        ['open library', 'company', { section: 'library', companyId: 'hearth' }], ['open connections', 'company', { section: 'connections' }],
    ])('%s opens the intended workspace', async (text, module, payload) => {
        const d = deps(); const result = await executeOsVoiceIntent(parseOsVoiceIntent(text, context), d);
        expect(result.success).toBe(true); expect(d.open).toHaveBeenCalledWith(module, expect.objectContaining(payload)); expect(d.ask).not.toHaveBeenCalled();
    });
    it('uses an explicit company instead of the currently focused company and carries the reporting period', async () => {
        const d = deps();
        await executeOsVoiceIntent(parseOsVoiceIntent('open analytics for PlayBound over the last 28 days', context), d);
        expect(d.open).toHaveBeenCalledWith('company', { companyId: 'playbound', companyName: 'Playbound.club', section: 'overview', period: '28' });
    });
    it('resolves possessive names and asks for a company when the portfolio has no focus', async () => {
        const d = deps(); await executeOsVoiceIntent(parseOsVoiceIntent("Open Hearth's people", context), d);
        expect(d.open).toHaveBeenCalledWith('company', expect.objectContaining({ companyId: 'hearth', section: 'people' }));
        await executeOsVoiceIntent(parseOsVoiceIntent('open analytics'), d); expect(d.open).toHaveBeenLastCalledWith('companies');
    });
    it('refuses ambiguous and unauthorized company scopes without guessing', async () => {
        const d = deps(); d.companies.mockResolvedValue([hearth, { ...hearth, id: 'duplicate' }]);
        expect((await executeOsVoiceIntent(parseOsVoiceIntent('open Hearth'), d)).message).toContain('More than one');
        d.companies.mockResolvedValue([]);
        expect((await executeOsVoiceIntent(parseOsVoiceIntent('What needs review?', context), d)).success).toBe(false);
        expect(d.open).not.toHaveBeenCalled(); expect(d.ask).not.toHaveBeenCalled();
    });
    it.each(['Improve every casino review until it meets our quality standard', 'What work is running for each company?', 'Publish the new post', 'Open work and delete every job'])('routes substantive requests through Ask: %s', async text => {
        const d = deps(); const intent = parseOsVoiceIntent(text, context);
        expect(intent.type).toBe('ASK_NUCLEAS'); await executeOsVoiceIntent(intent, d);
        expect(d.ask).toHaveBeenCalledWith(text, hearth); expect(d.open).not.toHaveBeenCalled();
    });
    it('avoids model parsing and provider calls for OS commands', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const result = await parseIntentWithContext('open work', context);
        expect(result).toMatchObject({ ok: true, source: 'rules', intent: { type: 'OS_NAVIGATE' } }); expect(fetch).not.toHaveBeenCalled();
    });
    it('global navigation remains usable when the previous company is unavailable', async () => {
        const d = deps(); d.companies.mockRejectedValue(Error('offline'));
        const intent = parseOsVoiceIntent('open companies', context);
        expect(intent.slots.companyId).toBeUndefined();
        expect(intent.slots.companyName).toBeUndefined();
        expect((await executeOsVoiceIntent(intent, d)).success).toBe(true);
        expect(d.companies).not.toHaveBeenCalled();
    });
});
