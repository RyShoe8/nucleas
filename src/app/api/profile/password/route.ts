import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth/session';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { isValidObjectId } from '@/lib/utils/security';

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isValidObjectId(session.userId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    let { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 });
    }

    currentPassword = currentPassword.trim();
    newPassword = newPassword.trim();

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
    }

    await connectDB();

    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.authProvider === 'google' && !user.password) {
      return NextResponse.json({ error: 'Google accounts cannot change passwords here' }, { status: 400 });
    }

    if (!user.password) {
      return NextResponse.json({ error: 'No password set on this account' }, { status: 400 });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Incorrect current password' }, { status: 401 });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    user.password = newPasswordHash;
    await user.save();

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
