import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  session: { userId: 'u1' } as unknown,
  user: { isAdmin: true, email: 'a@example.com' } as unknown,
  transcribe: vi.fn(async () => 'open marketing'),
}));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: async () => mocks.session }));
vi.mock('@/lib/db/mongodb', () => ({ default: async () => undefined }));
vi.mock('@/lib/models/User', () => ({ default: { findById: () => ({ select: () => ({ lean: async () => mocks.user }) }) } }));
vi.mock('@/lib/auth/platformAdmin', () => ({ isPlatformAdmin: (u: { isAdmin?: boolean }) => Boolean(u.isAdmin) }));
vi.mock('@/lib/ai/transcribeAudio', () => ({ transcribeSpeech: mocks.transcribe }));
vi.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: () => null }));

import { POST } from './route';

const send = (file?: File) => {
  const form = new FormData();
  if (file) form.set('file', file);
  return POST(new NextRequest('https://nucleas.app/api/voice/stt', { method: 'POST', body: form }));
};
const audio = (size = 100, type = 'audio/webm') => new File([new Uint8Array(size)], 'speech.webm', { type });

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'key';
  mocks.session = { userId: 'u1' };
  mocks.user = { isAdmin: true, email: 'a@example.com' };
  mocks.transcribe.mockClear();
  mocks.transcribe.mockImplementation(async () => 'open marketing');
});

describe('transcribing a voice command', () => {
  it('returns what was said, not a placeholder', async () => {
    const res = await send(audio());
    expect(await res.json()).toEqual({ text: 'open marketing' });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm', 'key');
  });

  it('is for signed-in administrators only, and spends nothing on anyone else', async () => {
    mocks.session = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    expect((await send(audio())).status).toBe(401);
    mocks.session = { userId: 'u1' };
    mocks.user = { isAdmin: false, email: 'b@example.com' };
    expect((await send(audio())).status).toBe(403);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('refuses missing, oversized and non-audio files before transcribing', async () => {
    expect((await send()).status).toBe(400);
    expect((await send(audio(6 * 1024 * 1024))).status).toBe(413);
    expect((await send(audio(100, 'application/pdf'))).status).toBe(415);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('says so when it is not configured or the service fails', async () => {
    delete process.env.OPENAI_API_KEY;
    expect((await send(audio())).status).toBe(503);
    process.env.OPENAI_API_KEY = 'key';
    mocks.transcribe.mockImplementation(async () => { throw new Error('boom'); });
    const res = await send(audio());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('boom');
  });
});
