import '@/lib/billing-engine';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicPricingPlans, sortPlansForPricingDisplay } from 'billing-engine';
import { PricingPlansSection } from '@/components/pricing/PricingPlansSection';
import { NUCLEAS_PLATFORM_FEATURES } from '@/lib/marketing/nucleasPlatformFeatures';
import { pricingPlanCtaHref } from '@/lib/billing/pricingPlanCta';
import { getMarketingTrialCopy } from '@/lib/billing/marketingTrialCopy';
import { StructuredData } from '@/components/StructuredData';
import AnimateIn from '@/components/home/AnimateIn';

export const dynamic = 'force-dynamic';

const baseUrl = process.env.NEXTAUTH_URL || 'https://nucleas.app';

export async function generateMetadata(): Promise<Metadata> {
  const trial = await getMarketingTrialCopy();
  const description = `Nucleas pricing is simple: every plan includes the full platform. Pay for seats, not features.${trial.metadataTrialSuffix}`;
  return {
    title: 'Pricing — Simple, Seat-Based Plans',
    description,
    keywords: ['Nucleas pricing', 'business management pricing', 'seat-based pricing', 'SaaS pricing', 'free trial'],
    alternates: { canonical: '/pricing' },
    openGraph: {
      title: 'Pricing — Simple, Seat-Based Plans | Nucleas',
      description,
      url: `${baseUrl}/pricing`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Pricing | Nucleas',
      description,
    },
  };
}

export default async function PricingPage() {
  const trial = await getMarketingTrialCopy();
  const plans = sortPlansForPricingDisplay(await getPublicPricingPlans());
  const planCtas = await Promise.all(
    plans.map(async (plan) => ({
      id: plan.id,
      href: await pricingPlanCtaHref(plan.id),
    }))
  );
  const ctaByPlanId = Object.fromEntries(planCtas.map((entry) => [entry.id, entry.href]));

  const pricingFaq = [
    { q: 'Is there a free trial?', a: trial.pricingFaqTrialAnswer },
    {
      q: "What's included in every plan?",
      a: 'Every plan includes the full Nucleas platform — projects, tasks, content, meetings, tools, team management, and all features. Plans differ only by the number of seats included.',
    },
    {
      q: 'Can I change plans later?',
      a: 'Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect on your next billing cycle.',
    },
    { q: 'What happens after my trial ends?', a: trial.pricingFaqAfterTrialAnswer },
  ];

  return (
    <>
      <StructuredData type="WebPage" data={{ name: 'Pricing | Nucleas', description: (await generateMetadata()).description as string, url: `${baseUrl}/pricing`, publisher: { '@type': 'Organization', name: 'Nucleas', url: baseUrl } }} />
      <StructuredData type="BreadcrumbList" data={{ itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl }, { '@type': 'ListItem', position: 2, name: 'Pricing', item: `${baseUrl}/pricing` }] }} />

      <div className="min-h-screen bg-background">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />
          <div className="absolute top-1/3 -left-32 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-4xl mx-auto text-center">
            <AnimateIn>
              {trial.heroBadge ? (
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-sm font-semibold text-green-400 mb-6">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  {trial.heroBadge}
                </span>
              ) : null}
            </AnimateIn>
            <AnimateIn>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight mb-6">
                Simple,{' '}
                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">seat-based</span>{' '}
                pricing
              </h1>
            </AnimateIn>
            <AnimateIn>
              <p className="text-lg text-text-secondary max-w-2xl mx-auto">
                Every plan includes the full Nucleas platform. You pay for your organization&apos;s seats — not feature tiers. Add team members as you grow.
              </p>
            </AnimateIn>
          </div>
        </section>

        {/* Plan Cards */}
        <section className="px-4 sm:px-6 lg:px-8 pb-16">
          <AnimateIn>
            <PricingPlansSection plans={plans} ctaByPlanId={ctaByPlanId} />
          </AnimateIn>
        </section>

        {/* Everything Included */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20 md:pb-28">
          <div className="max-w-5xl mx-auto">
            <AnimateIn>
              <div className="text-center mb-12">
                <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
                  Everything included in{' '}
                  <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">every plan</span>
                </h2>
                <p className="text-text-secondary text-lg">
                  All subscribers get the same platform capabilities. Plans differ by included seats and add-on pricing.
                </p>
              </div>
            </AnimateIn>
            <AnimateIn>
              <ul className="grid sm:grid-cols-2 gap-3">
                {NUCLEAS_PLATFORM_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-xl border border-border bg-background-card px-5 py-4 text-sm text-text-primary"
                  >
                    <span className="text-primary mt-0.5 flex-shrink-0" aria-hidden>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </AnimateIn>
          </div>
        </section>

        {/* Pricing FAQ */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20 md:pb-28">
          <div className="max-w-3xl mx-auto">
            <AnimateIn>
              <h2 className="text-2xl font-bold text-text-primary text-center mb-10">Frequently asked questions</h2>
            </AnimateIn>
            <div className="space-y-4">
              {pricingFaq.map((faq) => (
                <AnimateIn key={faq.q}>
                  <div className="bg-background-card border border-border rounded-xl p-6">
                    <h3 className="text-base font-semibold text-text-primary mb-2">{faq.q}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{faq.a}</p>
                  </div>
                </AnimateIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20 md:pb-28">
          <div className="max-w-4xl mx-auto relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-accent/10 to-nucleas-fourth/10 border border-primary/20 p-10 md:p-16 text-center">
            <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
            <div className="relative">
              <AnimateIn>
                <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">Ready to get started?</h2>
                <p className="text-lg text-text-secondary mb-8 max-w-xl mx-auto">
                  {trial.featureCtaSubtext}
                </p>
                <Link href="/register" className="inline-flex items-center px-8 py-4 rounded-xl bg-primary text-nucleas-ink font-semibold text-lg hover:bg-primary-hover transition-all shadow-lg shadow-primary/25">
                  {trial.ctaButtonLabel}
                </Link>
              </AnimateIn>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
