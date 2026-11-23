import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, getSession } from '@/lib/auth/session';
import { startDesktopGrant, readDesktopGrant, approveDesktopGrant, consumeDesktopGrant, validDesktopId, validCallbackPort } from '@/lib/auth/desktopGrant';
import { createDesktopSession, renewDesktopSession, DESKTOP_REFRESH_COOKIE, DESKTOP_REFRESH_PATH } from '@/lib/auth/desktopSession';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';
import User from '@/lib/models/User';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) return json({ error: 'Invalid origin' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400);
    if (body.action === 'start') {
        const limited = enforceRateLimit({ key: rateLimitKey(request, 'desktop-login'), limit: 10, windowMs: 600_000 });
        if (limited) return limited;
        const callback = body.callbackPort !== undefined || body.callbackNonce !== undefined;
        if (callback && (!validCallbackPort(body.callbackPort) || !validDesktopId(body.callbackNonce))) return json({ error: 'Invalid desktop callback' }, 400);
        return json(await startDesktopGrant(callback ? { port: body.callbackPort, nonce: body.callbackNonce } : undefined));
    }
    if (body.action === 'refresh') {
        const limited = enforceRateLimit({ key: rateLimitKey(request, 'desktop-refresh'), limit: 60, windowMs: 3600_000 });
        if (limited) return limited;
        const token = request.cookies.get(DESKTOP_REFRESH_COOKIE)?.value;
        const session = token ? null : await getSession();
        // Upgrade existing installed-app sessions without another interactive login.
        // A rejected refresh token must never fall back to an old access cookie.
        const device = token ? await renewDesktopSession(token) : session && !session.desktopSessionId ? await createDesktopSession(session.userId) : null;
        if (!device) {
            (await cookies()).set(DESKTOP_REFRESH_COOKIE, '', { path: DESKTOP_REFRESH_PATH, maxAge: 0, httpOnly: true, secure: true, sameSite: 'strict' });
            return json({ error: 'Please sign in again.' }, 401);
        }
        return deviceResponse(device);
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
        const grant = await consumeDesktopGrant(body.requestId, body.proof, body.callbackCode);
        if (!grant) return json({ pending: true }, 202);
        const user = await User.findById(grant.userId);
        if (!user || effectiveRegistrationApproval(user.registrationApproval) !== 'approved') return json({ error: 'Account unavailable' }, 403);
        if (grant.callbackPort) {
            const device = await createDesktopSession(user._id.toString());
            if (!device) return json({ error: 'Account unavailable' }, 403);
            return deviceResponse(device);
        }
        await createSession(user._id.toString(), user.email);
        // Only the native main process has the proof; never sent to a renderer or URL.
        return json({ session: (await cookies()).get('session')!.value });
    }
    return json({ error: 'Invalid action' }, 400);
}

export async function GET(request: NextRequest) {
    const id = request.nextUrl.searchParams.get('request');
    if (!validDesktopId(id)) return json({ error: 'Invalid sign-in request.' }, 400);
    const grant = await readDesktopGrant(id);
    if (!grant) return json({ error: 'Sign-in request expired. Start again in Nucleas.' }, 410);
    let destination = `/desktop/connect?request=${id}`;
    if (grant.callbackPort) {
        destination = await getSession() ? `/api/auth/desktop/complete?request=${id}` : request.nextUrl.searchParams.get('method') === 'email' ? '/login' : '/api/auth/google';
    }
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set('desktop-login-return', id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function deviceResponse(device: NonNullable<Awaited<ReturnType<typeof createDesktopSession>>>) {
    await createSession(String(device.user._id), device.user.email, device.id);
    const store = await cookies();
    store.set(DESKTOP_REFRESH_COOKIE, device.token, { httpOnly: true, secure: true, sameSite: 'strict', path: DESKTOP_REFRESH_PATH, expires: device.expiresAt });
    // Refresh credentials remain HttpOnly; only the native fetch receives the short-lived session.
    return json({ session: store.get('session')!.value, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
}
