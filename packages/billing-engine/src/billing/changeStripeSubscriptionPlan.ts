import mongoose from 'mongoose';
import type Stripe from 'stripe';
import { isValidObjectIdString } from '../utils/objectId';
import {
  CheckoutSessionError,
  createCheckoutSessionForOrganization,
  validatePlanForCheckout,
} from './createCheckoutSession';
import { getEffectiveSeatCount } from './employeeLimits';
import type { BillingInterval } from './planPricing';
import { resolvePlanStripePrices } from './planPricing';
import { isActiveSubscriptionStatus } from './subscriptionAccess';
import { connectBillingDb, getBillingContext, getOrganizationModel } from '../context';
import type { OrganizationBillingFields } from '../types';
import { OrganizationSubscriptionModel } from '../models/OrganizationSubscription';
import { SubscriptionPlanModel, type SubscriptionPlanDoc } from '../models/SubscriptionPlan';
import { getStripe } from '../stripe/client';
import { persistOrganizationSubscriptionStripeItems } from '../stripe/subscriptionItemSync';
import { syncStripeSubscriptionSeatsForOrganization } from '../stripe/syncSubscriptionSeats';

export class ChangePlanError extends Error {
  constructor(
    message: string,
    public status: number = 400
  ) {
    super(message);
    this.name = 'ChangePlanError';
  }
}

export type ChangePlanResult =
  | { mode: 'checkout'; url: string }
  | { mode: 'updated'; subscriptionPlanId: string; planSlug: string };

export async function changeStripeSubscriptionPlan(args: {
  org: OrganizationBillingFields;
  userEmail?: string | null;
  subscriptionPlanId: string;
  billingInterval?: BillingInterval;
}): Promise<ChangePlanResult> {
  const planId = args.subscriptionPlanId.trim();
  if (!isValidObjectIdString(planId)) {
    throw new ChangePlanError('Invalid subscriptionPlanId', 400);
  }

  await connectBillingDb();
  const targetPlan = await SubscriptionPlanModel.findById(planId).lean<SubscriptionPlanDoc>();
  if (!targetPlan || targetPlan.archived) {
    throw new ChangePlanError('Plan not found', 404);
  }

  const orgId = args.org._id;
  const billingInterval: BillingInterval = args.billingInterval ?? 'month';
  await validatePlanForCheckout(targetPlan, orgId.toString(), billingInterval).catch((e) => {
    if (e instanceof CheckoutSessionError) {
      throw new ChangePlanError(e.message, e.status);
    }
    throw e;
  });

  const orgSub = await OrganizationSubscriptionModel.findOne({ organizationId: orgId }).lean();
  const hasRecurringStripeSub =
    Boolean(args.org.stripeSubscriptionId?.trim()) &&
    isActiveSubscriptionStatus(args.org.subscriptionStatus) &&
    isActiveSubscriptionStatus(orgSub?.status);

  const resolved = resolvePlanStripePrices(targetPlan, billingInterval);

  const useCheckout =
    targetPlan.interval === 'lifetime' ||
    !hasRecurringStripeSub ||
    !resolved.basePriceId;

  if (useCheckout) {
    try {
      const { url } = await createCheckoutSessionForOrganization({
        org: args.org,
        userEmail: args.userEmail,
        subscriptionPlanId: planId,
        billingInterval,
      });
      return { mode: 'checkout', url };
    } catch (e) {
      if (e instanceof CheckoutSessionError) {
        throw new ChangePlanError(e.message, e.status);
      }
      throw e;
    }
  }

  const stripe = getStripe();
  const subId = args.org.stripeSubscriptionId!.trim();
  await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });

  const orgSubDoc = orgSub;
  const currentPlan = orgSubDoc?.subscriptionPlanId
    ? await SubscriptionPlanModel.findById(orgSubDoc.subscriptionPlanId).lean<SubscriptionPlanDoc>()
    : null;

  const baseItemId = orgSubDoc?.stripeBaseItemId?.trim() || '';
  const seatItemId = orgSubDoc?.stripeSeatItemId?.trim() || '';

  const items: Stripe.SubscriptionUpdateParams.Item[] = [];

  if (baseItemId) {
    items.push({ id: baseItemId, price: resolved.basePriceId });
  } else {
    items.push({ price: resolved.basePriceId });
  }

  const ctx = getBillingContext();
  const orgIdStr = orgId.toString();
  if (ctx.seats.beforeCountSeats) {
    await ctx.seats.beforeCountSeats(orgIdStr);
  }
  const seatCount = getEffectiveSeatCount(await ctx.seats.getSeatCount(orgIdStr));
  const additional = Math.max(0, seatCount - (targetPlan.includedUsers ?? 1));
  const targetSupportsSeats =
    resolved.additionalUserPriceCents > 0 &&
    Boolean(resolved.seatPriceId) &&
    targetPlan.interval !== 'lifetime';

  if (!targetSupportsSeats) {
    if (seatItemId) {
      items.push({ id: seatItemId, deleted: true });
    }
  } else if (seatItemId) {
    items.push({ id: seatItemId, quantity: additional });
  } else if (additional > 0) {
    items.push({ price: resolved.seatPriceId, quantity: additional });
  }

  const updated = await stripe.subscriptions.update(subId, {
    items,
    proration_behavior: 'always_invoice',
    metadata: {
      organizationId: orgId.toString(),
      subscriptionPlanId: String(targetPlan._id),
      billingInterval: resolved.billingInterval,
    },
  });

  const planObjId = new mongoose.Types.ObjectId(String(targetPlan._id));
  await OrganizationSubscriptionModel.findOneAndUpdate(
    { organizationId: orgId },
    {
      $set: {
        subscriptionPlanId: planObjId,
        status: updated.status === 'trialing' ? 'trialing' : 'active',
        billingInterval: resolved.billingInterval,
      },
    },
    { upsert: true }
  );

  const OrganizationModel = getOrganizationModel();
  await OrganizationModel.findByIdAndUpdate(orgId, {
    $set: {
      plan: String(targetPlan.slug),
      subscriptionStatus: updated.status === 'trialing' ? 'trialing' : 'active',
    },
  });

  await persistOrganizationSubscriptionStripeItems(orgId, updated, targetPlan);
  await syncStripeSubscriptionSeatsForOrganization(orgId);

  void currentPlan;

  return {
    mode: 'updated',
    subscriptionPlanId: String(targetPlan._id),
    planSlug: String(targetPlan.slug),
  };
}
