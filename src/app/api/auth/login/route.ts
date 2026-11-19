import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import connectDB from '@/lib/db/mongodb';
import User, { isAdminEmail } from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { createSession } from '@/lib/auth/session';
import { isValidEmail, sanitizeString } from '@/lib/utils/security';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';
import {
  isEmailVerificationPending,
  migrateLegacyEmailVerified,
} from '@/lib/auth/emailVerification';
import { RECAPTCHA_ACTIONS } from '@/lib/recaptcha/actions';
import { recaptchaFailureResponse, verifyRecaptchaToken } from '@/lib/recaptcha/verifyRecaptcha';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

export async function POST(request: NextRequest) {
  try {
    const limit = enforceRateLimit({
      key: rateLimitKey(request, 'auth-login'),
      limit: 10,
      windowMs: 60_000,
    });
    if (limit) return limit;

    const body = await request.json();

    const captcha = await verifyRecaptchaToken({
      token: body.recaptchaToken,
      expectedAction: RECAPTCHA_ACTIONS.login,
    });
    if (!captcha.ok) return recaptchaFailureResponse(captcha);

    let { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Sanitize inputs
    email = sanitizeString(email, 254);
    password = password.trim();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Validate password length to prevent DoS
    if (password.length > 128) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Lowercase email to match database storage (User model has lowercase: true)
    email = email.toLowerCase();

    await connectDB();

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if user is using OAuth (no password)
    if (user.authProvider === 'google' && !user.password) {
      return NextResponse.json({ 
        error: 'This account uses Google sign-in. Please sign in with Google.' 
      }, { status: 401 });
    }

    // Verify password
    if (!user.password) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Set admin users (single source of truth in User model)
    if (isAdminEmail(user.email) && !user.isAdmin) {
      user.isAdmin = true;
    }

    // Backward compatibility: Set organizationId if missing (for existing users)
    if (!user.organizationId) {
      user.organizationId = user._id.toString();
    }

    // Fix organizationSetupComplete for existing users
    if (!user.organizationSetupComplete && user.organizationId) {
      const Organization = (await import('@/lib/models/Organization')).default;
      const org = await Organization.findOne({ userId: user._id });
      if (org || user._id.toString() === user.organizationId) {
        user.organizationSetupComplete = true;
      }
    }

    // Save any changes
    if (user.isModified()) {
      await user.save();
    }

    await migrateLegacyEmailVerified(user);

    if (isEmailVerificationPending(user)) {
      return NextResponse.json(
        {
          error: 'Please verify your email before signing in.',
          needsEmailVerification: true,
          email: user.email,
        },
        { status: 403 }
      );
    }

    if (effectiveRegistrationApproval(user.registrationApproval) === 'pending') {
      return NextResponse.json(
        { error: 'Your registration is awaiting approval from a Nucleas platform administrator.', awaitingApproval: true },
        { status: 403 }
      );
    }
    if (effectiveRegistrationApproval(user.registrationApproval) === 'rejected') {
      return NextResponse.json(
        { error: 'This registration was not approved. Contact Nucleas support if you believe this is an error.' },
        { status: 403 }
      );
    }

    // Create admin employee record if it doesn't exist
    const existingEmployee = await Employee.findOne({ userId: user._id });
    if (!existingEmployee) {
      await Employee.create({
        name: user.name || user.email.split('@')[0],
        role: 'Administrator',
        weeklyHours: 0,
        employeeType: 'full-time',
        userId: user._id,
        organizationId: user.organizationId,
      });
    }

    // Create session
    await createSession(user._id.toString(), user.email);

    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        organizationSetupComplete: user.organizationSetupComplete,
      },
    });
  } catch {
    // Login error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
