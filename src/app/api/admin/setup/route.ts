import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { isPlatformAdmin } from '@/lib/auth/platformAdmin';
import { requireAuth } from '@/lib/auth/middleware';

/**
 * One-time setup script to:
 * 1. Set admin users
 * 2. Fix organizationSetupComplete for existing users
 * 
 * This can be called once manually or run as a migration script
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    const setupSecret = process.env.PLATFORM_SETUP_SECRET;
    if (!setupSecret) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const providedSecret = request.headers.get('x-setup-secret');
    if (providedSecret !== setupSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();

    const caller = await User.findById(session.userId).select('isAdmin email').lean();
    if (!caller || !isPlatformAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminEmails = ['ryanschumacher@themediashop.co', 'kellymcguire@themediashop.co'];
    
    // Set admin users
    const adminUsers = await User.updateMany(
      { email: { $in: adminEmails.map(e => e.toLowerCase()) } },
      { $set: { isAdmin: true } }
    );

    // Fix organizationSetupComplete for existing users who have organizations
    // For users created before organization setup was required
    const Organization = (await import('@/lib/models/Organization')).default;
    const allUsers = await User.find({ organizationSetupComplete: { $ne: true } });
    
    let fixedCount = 0;
    for (const user of allUsers) {
      // Check if user has an organization
      const org = await Organization.findOne({ userId: user._id });
      if (org || user.organizationId) {
        user.organizationSetupComplete = true;
        await user.save();
        fixedCount++;
      }
    }

    return NextResponse.json({
      message: 'Setup complete',
      adminsSet: adminUsers.modifiedCount,
      usersFixed: fixedCount,
    });
  } catch {
    // Admin setup error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
