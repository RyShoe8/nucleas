import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { completeDesktopGrant, validDesktopId } from '@/lib/auth/desktopGrant';
import User from '@/lib/models/User';
import connectDB from '@/lib/db/mongodb';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
    const id = request.nextUrl.searchParams.get('request');
    const session = await getSession();
    if (!session || !validDesktopId(id) || request.cookies.get('desktop-login-return')?.value !== id) {
        return NextResponse.json({ error: 'Start sign-in again in Nucleas Desktop.' }, { status: 401 });
    }
    await connectDB();
    const user = await User.findById(session.userId);
    if (!user || effectiveRegistrationApproval(user.registrationApproval) !== 'approved') return NextResponse.json({ error: 'Account unavailable' }, { status: 403 });
    const callback = await completeDesktopGrant(id, session.userId);
    if (!callback) return NextResponse.json({ error: 'Sign-in expired or already completed. Return to Nucleas.' }, { status: 410 });
    const response = NextResponse.redirect(callback);
    response.cookies.delete('desktop-login-return');
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}
