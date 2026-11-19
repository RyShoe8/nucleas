import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import Invitation from '@/lib/models/Invitation';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { isValidObjectId } from '@/lib/utils/security';
import { teardownOrganization } from '@/lib/account/deleteUserAccount';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

/**
 * Update user (admin only)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;

    await connectDB();
    const { id } = await params;

    // Validate ObjectId format
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { isAdmin, registrationApproval } = body;

    // Update isAdmin status using updateOne to bypass pre-save hooks
    if (typeof isAdmin === 'boolean') {
      await User.updateOne({ _id: id }, { $set: { isAdmin } });
    }
    if (registrationApproval !== undefined) {
      if (registrationApproval !== 'approved' && registrationApproval !== 'rejected') {
        return NextResponse.json({ error: 'Approval status must be approved or rejected.' }, { status: 400 });
      }
      await User.updateOne(
        { _id: id },
        { $set: {
          registrationApproval,
          registrationReviewedAt: new Date(),
          registrationReviewedBy: auth.user._id,
        } }
      );
    }

    const updatedUser = await User.findById(id);

    return NextResponse.json({
      id: updatedUser!._id.toString(),
      email: updatedUser!.email,
      name: updatedUser!.name,
      isAdmin: updatedUser!.isAdmin || false,
      registrationApproval: effectiveRegistrationApproval(updatedUser!.registrationApproval),
    });
  } catch {
    // Admin update user error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Delete user (admin only)
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;

    await connectDB();
    const { id } = await params;

    // Validate ObjectId format
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (targetUser._id.toString() === auth.user._id.toString()) {
      return NextResponse.json(
        { error: 'You cannot delete your own account from the admin panel.' },
        { status: 400 }
      );
    }

    const orgId = targetUser.organizationId;
    const orgUserCount = await User.countDocuments({ organizationId: orgId });

    if (orgUserCount === 1) {
      await teardownOrganization(orgId);
      return NextResponse.json({
        message: 'User and organization deleted successfully',
        organizationRemoved: true,
      });
    }

    // Delete invitations sent by or to this user
    await Invitation.deleteMany({
      $or: [
        { invitedBy: targetUser._id }, // Invitations sent by this user
        { email: targetUser.email.toLowerCase() }, // Invitations sent to this user
      ],
    });

    // Delete employees linked to this user
    await Employee.deleteMany({
      $or: [
        { userId: targetUser._id }, // Employees linked by user ID
        { email: targetUser.email.toLowerCase() }, // Employees linked by email
      ],
    });

    // Delete the user
    await User.findByIdAndDelete(id);

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch {
    // Admin delete user error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
