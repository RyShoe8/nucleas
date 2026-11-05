import 'server-only';
import { Types } from 'mongoose';
import { PropertyOverview } from '@/lib/models/PropertyOverview';
import { approvedMarketingPlan } from '@/lib/jobs/marketingPlans';

/**
 * The plans upstream of any company work, as compact prompt context: the completed Company Overview (what the
 * company is and who it serves) and the approved Marketing Plan (positioning, pillars, what to avoid). The
 * overview drives the plan and the plan drives everything below it: jobs, watches, digests and posts all
 * read this, so their output stays on strategy. Short on purpose, so cheap models can carry it.
 */
export async function upstreamContext(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string, maxChars = 3200): Promise<string> {
  const org = new Types.ObjectId(String(organizationId));
  const company = new Types.ObjectId(String(companyId));
  const [overview, plan] = await Promise.all([
    PropertyOverview.findOne({ organizationId: org, companyId: company, status: 'complete' })
      .sort({ completedAt: -1, createdAt: -1 })
      .select('propertyDescription primaryKeywords demographicTarget')
      .lean<{ propertyDescription?: string; primaryKeywords?: string[]; demographicTarget?: string }>()
      .catch(() => null),
    approvedMarketingPlan(org, company).catch(() => null),
  ]);
  return renderUpstream(overview, plan, maxChars);
}

type OverviewFacts = { propertyDescription?: string; primaryKeywords?: string[]; demographicTarget?: string };
type PlanFacts = { summary?: string; audience?: string; positioning?: string; messagingPillars: string[]; socialContentPillars: string[]; excludedTopics: string[] };
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Each part has its own limit and what to avoid comes first in the plan, so one long part can never push it out. */
export function renderUpstream(overview: OverviewFacts | null, plan: PlanFacts | null, maxChars = 3200): string {
  const lines: string[] = [];
  if (overview) {
    lines.push('Company Overview:');
    if (overview.propertyDescription) lines.push(`- What it is: ${clip(overview.propertyDescription, 700)}`);
    if (overview.demographicTarget) lines.push(`- Audience: ${clip(overview.demographicTarget, 300)}`);
    if (overview.primaryKeywords?.length) lines.push(`- Topics: ${clip(overview.primaryKeywords.slice(0, 12).join(', '), 200)}`);
  }
  if (plan) {
    lines.push('Approved Marketing Plan:');
    if (plan.excludedTopics.length) lines.push(`- Avoid: ${clip(plan.excludedTopics.join('; '), 600)}`);
    if (plan.summary) lines.push(`- Summary: ${clip(plan.summary, 500)}`);
    if (plan.audience) lines.push(`- Audience: ${clip(plan.audience, 300)}`);
    if (plan.positioning) lines.push(`- Positioning: ${clip(plan.positioning, 400)}`);
    if (plan.messagingPillars.length) lines.push(`- Messaging pillars: ${clip(plan.messagingPillars.join('; '), 400)}`);
    if (plan.socialContentPillars.length) lines.push(`- Content pillars: ${clip(plan.socialContentPillars.join('; '), 400)}`);
  }
  return clip(lines.join('\n'), maxChars);
}
