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
export async function upstreamContext(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string, maxChars = 2400): Promise<string> {
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
  const lines: string[] = [];
  if (overview) {
    lines.push('Company Overview:');
    if (overview.propertyDescription) lines.push(`- What it is: ${overview.propertyDescription}`);
    if (overview.demographicTarget) lines.push(`- Audience: ${overview.demographicTarget}`);
    if (overview.primaryKeywords?.length) lines.push(`- Topics: ${overview.primaryKeywords.slice(0, 12).join(', ')}`);
  }
  if (plan) {
    lines.push('Approved Marketing Plan:');
    if (plan.summary) lines.push(`- Summary: ${plan.summary}`);
    if (plan.audience) lines.push(`- Audience: ${plan.audience}`);
    if (plan.positioning) lines.push(`- Positioning: ${plan.positioning}`);
    if (plan.messagingPillars.length) lines.push(`- Messaging pillars: ${plan.messagingPillars.join('; ')}`);
    if (plan.socialContentPillars.length) lines.push(`- Content pillars: ${plan.socialContentPillars.join('; ')}`);
    if (plan.excludedTopics.length) lines.push(`- Avoid: ${plan.excludedTopics.join('; ')}`);
  }
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
