import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ role: 'Administrator', fail: false }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: () => null, rateLimitKey: () => 'k' }));
vi.mock('@/lib/companies/osRouteContext', () => ({
  requireCompanyViewer: async () => ({ userId: 'u'.repeat(24), organizationId: 'org', employeeId: null, role: state.role }),
}));
vi.mock('@/lib/ai/company/companyAssistant', () => ({
  listAssistantTurns: async () => [],
  askAssistant: async (_viewer: unknown, input: { onProgress?: (t: string) => void }) => {
    if (state.fail) throw new TypeError("Cannot read properties of undefined (reading 'plan')");
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

describe('Ask failures', () => {
  const failing = async (role: string, accept?: string) => {
    state.role = role;
    state.fail = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      return await POST(request(accept));
    } finally {
      quiet.mockRestore();
      state.fail = false;
      state.role = 'Administrator';
    }
  };

  it('tells administrators what actually failed, in both the streamed and plain responses', async () => {
    const streamed = (await (await failing('Administrator', 'application/x-ndjson')).text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(streamed.at(-1)).toMatchObject({ type: 'error', status: 500 });
    expect(streamed.at(-1).error).toContain("Administrator detail: TypeError: Cannot read properties of undefined (reading 'plan')");
    const plain = await failing('Administrator');
    expect(plain.status).toBe(500);
    expect((await plain.json()).error).toContain('Administrator detail: TypeError');
  });

  it('keeps the message generic for everyone else', async () => {
    const res = await failing('Employee');
    expect(await res.json()).toEqual({ error: 'The assistant could not answer. Try again.' });
  });
});
