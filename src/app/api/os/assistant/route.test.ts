import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: () => null, rateLimitKey: () => 'k' }));
vi.mock('@/lib/companies/osRouteContext', () => ({
  requireCompanyViewer: async () => ({ userId: 'u'.repeat(24), organizationId: 'org', employeeId: null, role: 'Administrator' }),
}));
vi.mock('@/lib/ai/company/companyAssistant', () => ({
  listAssistantTurns: async () => [],
  askAssistant: async (_viewer: unknown, input: { onProgress?: (t: string) => void }) => {
    input.onProgress?.('Planning how to answer with o4-mini');
    input.onProgress?.('Planning how to answer with o4-mini');
    input.onProgress?.("Reading Frugal Gambler's metrics");
    return { ok: true, reply: { turn: { id: 't1', role: 'assistant', text: 'Done.' }, actions: [], focused: [], contextSources: [] } };
  },
}));

import { POST } from './route';

const request = (accept?: string) =>
  new NextRequest('https://os.nucleas.test/api/os/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
    body: JSON.stringify({ text: 'How is Frugal Gambler doing?' }),
  });

describe('Ask streaming', () => {
  it('streams progress lines (without repeats) and then the reply', async () => {
    const res = await POST(request('application/x-ndjson'));
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(events.map((e) => (e.type === 'progress' ? e.text : e.type))).toEqual(['Planning how to answer with o4-mini', "Reading Frugal Gambler's metrics", 'reply']);
    expect(events[2].turn.text).toBe('Done.');
  });

  it('still answers with plain JSON for callers that do not ask for a stream', async () => {
    const res = await POST(request());
    expect(await res.json()).toMatchObject({ turn: { text: 'Done.' } });
  });
});
