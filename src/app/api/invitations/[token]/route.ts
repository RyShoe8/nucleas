import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import Invitation from '@/lib/models/Invitation';

/**
 * GET /api/invitations/[token] - Get invitation details by token
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    await connectDB();

    const invitation = await Invitation.findOne({ token, status: 'pending' }).populate(
      'invitedBy',
      'name email'
    );

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found or already used' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date() > invitation.expiresAt) {
      // Update status to expired
      invitation.status = 'expired';
      await invitation.save();
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
    }

    return NextResponse.json(invitation);
  } catch {
    // Get invitation by token error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
