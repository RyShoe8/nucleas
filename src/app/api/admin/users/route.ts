import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import '@/lib/billing-engine';
import User from '@/lib/models/User';
import Organization from '@/lib/models/Organization';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import {
  connectBillingDb,
  OrganizationSubscriptionModel,
  type SubscriptionPlanDoc,
} from 'billing-engine';
import mongoose from 'mongoose';
import { effectiveRegistrationApproval } from '@/lib/auth/registrationApproval';

/**
 * Get all users (admin only)
 */
export async function GET(_request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;

    await connectDB();
    await connectBillingDb();

    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    const ownerIds = [
      ...new Set(
        users
          .map((u) => (u.organizationId ? String(u.organizationId) : null))
          .filter(
            (id): id is string =>
              !!id && id !== 'unknown' && mongoose.Types.ObjectId.isValid(id)
          )
      ),
    ];

    const orgs = ownerIds.length
      ? await Organization.find({
          userId: { $in: ownerIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean()
      : [];

    const orgByOwnerId = new Map(
      orgs.map((org) => [org.userId.toString(), org])
    );

    const orgMongoIds = orgs.map((org) => org._id);
    const subscriptions = orgMongoIds.length
      ? await OrganizationSubscriptionModel.find({
          organizationId: { $in: orgMongoIds },
        })
          .populate<{ subscriptionPlanId: SubscriptionPlanDoc | null }>('subscriptionPlanId')
          .lean()
      : [];

    const subByOrgId = new Map(
      subscriptions.map((sub) => [sub.organizationId.toString(), sub])
    );

    const usersWithOrg = users.map((u) => {
      let organizationName = 'N/A';
      let organizationDomain: string | null = null;
      let organizationMongoId: string | null = null;
      let plan: string | null = null;
      let subscriptionStatus: string | null = null;
      let subscriptionPlanId: string | null = null;
      let planName: string | null = null;

      const ownerKey = u.organizationId ? String(u.organizationId) : null;
      const org = ownerKey ? orgByOwnerId.get(ownerKey) : undefined;

      if (org) {
        organizationName = org.name;
        organizationDomain = org.domain || null;
        organizationMongoId = org._id.toString();
        plan = org.plan ?? null;
        subscriptionStatus = org.subscriptionStatus ?? null;

        const sub = subByOrgId.get(org._id.toString());
        if (sub) {
          const populated = sub.subscriptionPlanId;
          if (populated && typeof populated === 'object' && '_id' in populated) {
            subscriptionPlanId = (populated as SubscriptionPlanDoc)._id.toString();
            planName = (populated as SubscriptionPlanDoc).name;
          } else if (populated) {
            subscriptionPlanId = String(populated);
          }
        }
      }

      return {
        id: u._id.toString(),
        email: u.email,
        name: u.name || 'N/A',
        organizationId: ownerKey ?? 'unknown',
        organizationName,
        organizationDomain,
        organizationMongoId,
        plan,
        planName,
        subscriptionStatus,
        subscriptionPlanId,
        createdAt: u.createdAt,
        isAdmin: u.isAdmin || false,
        registrationApproval: effectiveRegistrationApproval(u.registrationApproval),
        registrationReviewedAt: u.registrationReviewedAt ?? null,
      };
    });

    return NextResponse.json({
      totalUsers: users.length,
      users: usersWithOrg,
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
