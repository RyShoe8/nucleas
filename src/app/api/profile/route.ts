import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { isValidEmail, sanitizeString, isValidObjectId } from '@/lib/utils/security';

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate session userId
    if (!isValidObjectId(session.userId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    let { name, email } = body;

    await connectDB();

    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Sanitize and validate inputs
    if (email !== undefined) {
      email = sanitizeString(email, 254);
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
      
      // Check if email is being changed and if it's already taken
      if (email !== user.email) {
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
          return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
        }
        user.email = email.toLowerCase();
      }
    }

    if (name !== undefined) {
      name = sanitizeString(name, 100);
      user.name = name || undefined;
    }

    await user.save();

    return NextResponse.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
      },
    });
  } catch {
    // Profile update error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
