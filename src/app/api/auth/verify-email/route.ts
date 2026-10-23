import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { createSession } from '@/lib/auth/session';
import { hashEmailVerificationToken } from '@/lib/auth/emailVerification';
import { getAppBaseUrl } from '@/lib/utils/invitation';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  const base = getAppBaseUrl();

  if (!token) {
    return NextResponse.redirect(`${base}/verify-email?error=missing_token`);
  }

  try {
    await connectDB();
    const tokenHash = hashEmailVerificationToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return NextResponse.redirect(`${base}/verify-email?error=invalid_or_expired`);
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    if (effectiveRegistrationApproval(user.registrationApproval) === 'pending') {
      return NextResponse.redirect(`${base}/pending-approval?verified=1`);
    }
    if (effectiveRegistrationApproval(user.registrationApproval) === 'rejected') {
      return NextResponse.redirect(`${base}/login?error=registration_rejected`);
    }

    await createSession(user._id.toString(), user.email);

    const destination = user.organizationSetupComplete ? '/' : '/setup-organization';
    return NextResponse.redirect(`${base}${destination}?verified=1`);
  } catch (error) {
    console.error('verify-email error:', error);
    return NextResponse.redirect(`${base}/verify-email?error=server`);
  }
}
