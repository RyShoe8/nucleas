import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, getSession } from '@/lib/auth/session';
import { startDesktopGrant, readDesktopGrant, approveDesktopGrant, consumeDesktopGrant, validDesktopId } from '@/lib/auth/desktopGrant';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';
import User from '@/lib/models/User';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400);
    if (body.action === 'start') {
        const limited = enforceRateLimit({ key: rateLimitKey(request, 'desktop-login'), limit: 10, windowMs: 600_000 });
        if (limited) return limited;
        return json(await startDesktopGrant());
    }
    if (!validDesktopId(body.requestId)) return json({ error: 'Invalid request' }, 400);
    if (body.action === 'approve') {
        if (request.headers.get('origin') !== request.nextUrl.origin) return json({ error: 'Invalid origin' }, 403);
        const session = await getSession();
        if (!session) return json({ error: 'Sign in first' }, 401);
        const grant = await approveDesktopGrant(body.requestId, session.userId);
        if (!grant) return json({ error: 'This request expired or was already used. Start again in the desktop app.' }, 410);
        (await cookies()).delete('desktop-login-return');
        return json({ approved: true });
    }
    if (body.action === 'exchange' && validDesktopId(body.proof)) {
        const grant = await consumeDesktopGrant(body.requestId, body.proof);
        if (!grant) return json({ pending: true }, 202);
        const user = await User.findById(grant.userId);
        if (!user || effectiveRegistrationApproval(user.registrationApproval) !== 'approved') return json({ error: 'Account unavailable' }, 403);
        await createSession(user._id.toString(), user.email);
        // Only the native main process has the proof; never sent to a renderer or URL.
        return json({ session: (await cookies()).get('session')!.value });
    }
    return json({ error: 'Invalid action' }, 400);
}

export async function GET(request: NextRequest) {
    const id = request.nextUrl.searchParams.get('request');
    if (!validDesktopId(id) || !await readDesktopGrant(id)) return json({ error: 'Sign-in request expired. Start again in Nucleas.' }, 410);
    const response = NextResponse.redirect(new URL(`/desktop/connect?request=${id}`, request.url));
    response.cookies.set('desktop-login-return', id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
