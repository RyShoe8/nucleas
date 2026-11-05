import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { isPlatformAdmin } from '@/lib/auth/platformAdmin';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { transcribeSpeech } from '@/lib/ai/transcribeAudio';
import { enforceRateLimit } from '@/lib/security/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A voice command is at most 30 seconds, which is far below this. */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Transcribes a short voice command, for apps with no speech service of their own (the desktop app). Voice is admin-only. */
export async function POST(request: NextRequest) {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;
    await connectDB();
    const user = await User.findById(session.userId).select('isAdmin email').lean<{ isAdmin?: boolean; email?: string }>();
    if (!user || !isPlatformAdmin(user)) return NextResponse.json({ error: 'Voice commands are limited to administrators.' }, { status: 403 });
    const limited = enforceRateLimit({ key: `voice-stt:${session.userId}`, limit: 20, windowMs: 60_000 });
    if (limited) return limited;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'No audio was received. Try again.' }, { status: 400 });
    if (file.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'That recording is too long for a voice command.' }, { status: 413 });
    if (!file.type.startsWith('audio/')) return NextResponse.json({ error: 'That is not an audio recording.' }, { status: 415 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Speech recognition is not configured on the server (OPENAI_API_KEY).' }, { status: 503 });
    try {
        return NextResponse.json({ text: await transcribeSpeech(Buffer.from(await file.arrayBuffer()), file.type, apiKey) });
    } catch (error) {
        console.error('[voice/stt] transcription failed', error instanceof Error ? error.message : 'unknown');
        return NextResponse.json({ error: 'Transcription failed. Try again.' }, { status: 502 });
    }
}
