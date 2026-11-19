'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Modal from '@/components/ui/Modal';
import { PricingPlanCard } from 'billing-engine/next/components';
import type { PublicPricingPlan, EmployeeLimitInfo } from 'billing-engine/client';
import { trialWontBeChargedUntil } from 'billing-engine/client';
import { seatUsageLine } from '@/lib/billing/seatDisplay';
import { consumeSelectedPlanId, consumeSelectedBillingInterval } from '@/lib/billing/selectedPlanStorage';
import { BillingPlanSelectCard } from '@/components/billing/BillingPlanSelectCard';
import { OnboardingBookingPanel } from '@/components/billing/OnboardingBookingPanel';
import { PAGE_GUTTER_WIDE_CLASS } from '@/lib/ui/mobileLayout';

type BillingSummary = {
  renewsAt?: string | null;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  subscriptionStatus?: string;
  canCancel?: boolean;
  canReactivate?: boolean;
  canChangePlan?: boolean;
};

type BillingPayload = {
  organization?: Record<string, unknown> | null;
  billing?: BillingSummary | null;
  currentPlan?: PublicPricingPlan | null;
  availablePlans?: PublicPricingPlan[];
  seatLimits?: EmployeeLimitInfo | null;
  viewer?: { role?: string };
};

function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function BillingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planFromQuery = searchParams.get('plan');
  const intervalFromQuery = searchParams.get('interval') === 'year' ? 'year' : 'month';
  const checkoutSuccess = searchParams.get('checkout') === 'success';
  const autoPlanHandledRef = useRef(false);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PublicPricingPlan | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PublicPricingPlan[]>([]);
  const [seatLimits, setSeatLimits] = useState<EmployeeLimitInfo | null>(null);
  const [viewerRole, setViewerRole] = useState<string>('member');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [reactivatePending, setReactivatePending] = useState(false);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [changePlanPendingId, setChangePlanPendingId] = useState<string | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRes = await fetch('/api/auth/me');
      const me = await meRes.json().catch(() => null);
      if (!me?.id) {
        router.push('/login');
        return;
      }
      if (!me.isOrgOwner) {
        router.push('/');
        return;
      }
      if (!cancelled) setAccessChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadBilling = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/dashboard/billing');
    const data = (await res.json().catch(() => ({}))) as BillingPayload & { error?: string };
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Could not load billing status');
    }
    setBilling(data.billing ?? null);
    setCurrentPlan(data.currentPlan ?? null);
    setAvailablePlans(data.availablePlans ?? []);
    setSeatLimits(data.seatLimits ?? null);
    setViewerRole(data.viewer?.role ?? 'member');
    setBillingLoaded(true);
  }, []);

  useEffect(() => {
    if (!accessChecked) return;
    let cancelled = false;
    loadBilling().catch((e: unknown) => {
      if (!cancelled) {
        setBilling(null);
        setCurrentPlan(null);
        setLoadError(e instanceof Error ? e.message : 'Could not load billing status');
        setBillingLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accessChecked, loadBilling]);

  const isOwner = viewerRole === 'owner';

  const changePlanOptions = useMemo(() => {
    if (!currentPlan) return availablePlans.filter((p) => !p.soldOut);
    return availablePlans.filter(
      (p) => p.id !== currentPlan.id && p.slug !== currentPlan.slug && !p.soldOut
    );
  }, [availablePlans, currentPlan]);

  async function cancelSubscription() {
    const endsLabel = formatBillingDate(billing?.renewsAt ?? null);
    const ok = window.confirm(
      `Cancel your subscription at the end of the current billing period?\n\nYou will keep full access until ${endsLabel}. Your subscription will not renew after that date.`
    );
    if (!ok) return;

    setActionError(null);
    setCancelPending(true);
    try {
      const res = await fetch('/api/stripe/cancel-subscription', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          typeof data.error === 'string' ? data.error : 'Could not cancel subscription'
        );
        return;
      }
      await loadBilling();
    } catch {
      setActionError('Could not cancel subscription');
    } finally {
      setCancelPending(false);
    }
  }

  async function reactivateSubscription() {
    setActionError(null);
    setReactivatePending(true);
    try {
      const res = await fetch('/api/stripe/reactivate-subscription', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          typeof data.error === 'string' ? data.error : 'Could not keep subscription'
        );
        return;
      }
      await loadBilling();
    } catch {
      setActionError('Could not keep subscription');
    } finally {
      setReactivatePending(false);
    }
  }

  async function selectPlan(planId: string, billingInterval: 'month' | 'year' = 'month') {
    setActionError(null);
    setChangePlanPendingId(planId);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionPlanId: planId, billingInterval }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(typeof data.error === 'string' ? data.error : 'Could not change plan');
        return;
      }
      if (data.mode === 'checkout' && data.url) {
        window.location.href = data.url as string;
        return;
      }
      setChangePlanOpen(false);
      await loadBilling();
    } catch {
      setActionError('Could not change plan');
    } finally {
      setChangePlanPendingId(null);
    }
  }

  useEffect(() => {
    if (!accessChecked || !billingLoaded || loadError || autoPlanHandledRef.current) return;

    const storedPlanId = planFromQuery ? null : consumeSelectedPlanId();
    const storedInterval = planFromQuery ? intervalFromQuery : consumeSelectedBillingInterval();
    const planId = (planFromQuery ?? storedPlanId)?.trim();
    if (!planId || viewerRole !== 'owner') {
      autoPlanHandledRef.current = true;
      return;
    }

    autoPlanHandledRef.current = true;

    if (currentPlan?.id === planId) return;

    const target = availablePlans.find((plan) => plan.id === planId);
    if (!target || target.soldOut) return;

    void selectPlan(planId, storedInterval);
  }, [
    accessChecked,
    billingLoaded,
    loadError,
    planFromQuery,
    intervalFromQuery,
    viewerRole,
    availablePlans,
    currentPlan?.id,
  ]);

  useEffect(() => {
    if (!billingLoaded || !checkoutSuccess || !currentPlan?.onboardingCallsEnabled) return;
    setOnboardingModalOpen(true);
  }, [billingLoaded, checkoutSuccess, currentPlan?.onboardingCallsEnabled]);

  const showOnboardingPanel =
    isOwner && currentPlan?.onboardingCallsEnabled && !loadError && billing?.subscriptionStatus !== 'none';

  const usageLine = seatUsageLine(seatLimits, currentPlan);

  if (!accessChecked) {
    return (
      <div className={`min-h-screen bg-background ${PAGE_GUTTER_WIDE_CLASS} py-8`}>
        <div className="max-w-3xl min-w-0 mx-auto w-full">
          <p className="text-sm text-text-secondary">Loading billing…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background ${PAGE_GUTTER_WIDE_CLASS} py-8`}>
      <div className="max-w-3xl min-w-0 mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Billing</h1>
          <p className="text-text-secondary text-sm mt-1">
            Manage your subscription, plan, and team seats.
          </p>
        </div>

        {loadError ? (
          <p className="text-sm text-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {actionError ? (
          <p className="text-sm text-error" role="alert">
            {actionError}
          </p>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">Your plan</h2>
          {currentPlan && !loadError ? (
            <>
              <PricingPlanCard plan={currentPlan} variant="current" />
              {usageLine ? (
                <p className="text-sm text-text-secondary">{usageLine}</p>
              ) : null}
            </>
          ) : !loadError ? (
            <Card className="p-6">
              <p className="text-sm text-text-secondary">
                No active plan on file.{' '}
                {isOwner && billing?.canChangePlan
                  ? 'Choose a plan below to subscribe.'
                  : 'Contact your organization owner to subscribe.'}
              </p>
            </Card>
          ) : null}
        </section>

        <Card className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Subscription</h2>
            <p className="text-sm text-text-secondary mt-1">
              Status: {loadError ? '—' : billing?.subscriptionStatus ?? '—'}
              {billing?.subscriptionStatus === 'trialing' && billing?.trialEndsAt && !loadError
                ? ` · Trial ends ${formatBillingDate(billing.trialEndsAt)}`
                : null}
              {billing?.renewsAt && !loadError
                ? ` · ${billing.cancelAtPeriodEnd ? 'Access until' : 'Renews'} ${formatBillingDate(billing.renewsAt)}`
                : ''}
            </p>
          </div>

          {billing?.cancelAtPeriodEnd && billing.renewsAt && !loadError ? (
            <p className="text-sm text-text-secondary rounded-md border border-border bg-muted/40 px-3 py-2">
              Your subscription is scheduled to cancel on {formatBillingDate(billing.renewsAt)}.
              You keep full access until then.
            </p>
          ) : null}

          {billing?.subscriptionStatus === 'trialing' && billing?.trialEndsAt && !loadError ? (
            <p className="text-sm text-primary rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
              {trialWontBeChargedUntil(billing.trialEndsAt)}
            </p>
          ) : null}

          {isOwner && !loadError ? (
            <div className="flex flex-wrap gap-2">
              {billing?.canChangePlan ? (
                <Button type="button" variant="secondary" onClick={() => setChangePlanOpen(true)}>
                  Change plan
                </Button>
              ) : null}
              {billing?.canCancel ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cancelPending}
                  onClick={() => void cancelSubscription()}
                >
                  {cancelPending ? 'Scheduling cancellation…' : 'Cancel subscription'}
                </Button>
              ) : null}
              {billing?.canReactivate ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={reactivatePending}
                  onClick={() => void reactivateSubscription()}
                >
                  {reactivatePending ? 'Updating…' : 'Keep subscription'}
                </Button>
              ) : null}
            </div>
          ) : null}

          {!isOwner && !loadError ? (
            <p className="text-xs text-text-secondary">
              Only the organization owner can change plan or cancel billing.
            </p>
          ) : null}
        </Card>

        {showOnboardingPanel ? (
          <OnboardingBookingPanel />
        ) : null}

        <Modal
          isOpen={changePlanOpen}
          onClose={() => setChangePlanOpen(false)}
          title="Change plan"
          maxWidth="lg"
        >
          <p className="text-sm text-text-secondary mb-4">
            Select a plan. You may be redirected to Stripe checkout for new subscriptions.
            Recurring plan changes are prorated on your current subscription.
          </p>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {changePlanOptions.length === 0 ? (
              <p className="text-sm text-text-secondary">No other plans are available right now.</p>
            ) : (
              changePlanOptions.map((plan) => (
                <BillingPlanSelectCard
                  key={plan.id}
                  plan={plan}
                  disabled={changePlanPendingId !== null}
                  pending={changePlanPendingId === plan.id}
                  onSelect={(planId, billingInterval) => void selectPlan(planId, billingInterval)}
                />
              ))
            )}
          </div>
        </Modal>

        <Modal
          isOpen={onboardingModalOpen}
          onClose={() => setOnboardingModalOpen(false)}
          title="Schedule your onboarding call"
          maxWidth="lg"
        >
          <OnboardingBookingPanel
            title="Book your onboarding call"
            onBooked={() => setOnboardingModalOpen(false)}
          />
        </Modal>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className={`min-h-screen bg-background ${PAGE_GUTTER_WIDE_CLASS} py-8`}>
          <div className="max-w-3xl min-w-0 mx-auto w-full">
            <p className="text-sm text-text-secondary">Loading billing…</p>
          </div>
        </div>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}
