export const TEAM_ROLES = ['design', 'creative', 'engineering', 'support', 'operations', 'tester', 'marketing'] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export const TEAM: Record<TeamRole, { name: string; remit: string; process: string; active: boolean }> = {
  design: { name: 'Design', remit: 'UI and UX: make products clear, accessible and effortless to use.', process: 'Understand the user journey, inspect the existing interface, propose a coherent interaction, then verify accessibility and states.', active: true },
  creative: { name: 'Creative', remit: 'Create original images, logos and other finished brand assets.', process: 'Read the approved brand and references, develop a specific visual brief, create the asset using available tools, then inspect it against the brief.', active: true },
  engineering: { name: 'Engineering', remit: 'Code, architecture and reliable product delivery.', process: 'Inspect existing code and decisions, plan a bounded change, delegate focused coding tasks, then run relevant checks and review the actual diff.', active: true },
  support: { name: 'Support', remit: 'Resolve user inquiries across connected communication channels.', process: 'Read the customer conversation and verified product context, identify the actual problem, draft a useful response, then verify claims and authorization before sending.', active: true },
  operations: { name: 'Operations', remit: 'Help every member use resources efficiently and recommend workflow improvements.', process: 'Look for repeated failed approaches, duplicated research and avoidable model calls. Reuse fresh verified evidence; propose specific improvements without reducing quality or changing budgets or permissions.', active: true },
  tester: { name: 'Tester', remit: 'Reserved for platform testing. Not configured or active.', process: '', active: false },
  marketing: { name: 'Marketing', remit: 'Grow the company’s audience and user base with evidence-led campaigns and useful content.', process: 'Start from company strategy and audience evidence, choose channels and success criteria, delegate discovery and extraction, then verify claims, brand voice and the final deliverable.', active: true },
};

/** Additive conversion: old jobs retain their identity, schedule and history; a manager can override ownership. */
export function teamRoleFor(job: { teamRole?: string | null; request?: string; design?: unknown }): TeamRole {
  if (TEAM_ROLES.includes(job.teamRole as TeamRole) && job.teamRole !== 'tester') return job.teamRole as TeamRole;
  const d = job.design && typeof job.design === 'object' ? job.design as { skill?: string; title?: string; category?: string } : {};
  if (['social_publish', 'casino_discovery', 'signature_outreach', 'marketing_plan', 'seo_brief', 'brand_voice', 'link_building', 'property_overview'].includes(d.skill ?? '')) return 'marketing';
  const text = `${d.title ?? ''} ${job.request ?? ''}`.toLowerCase();
  if (/\b(ui|ux|user interface|user experience|wireframes?|usability)\b/.test(text)) return 'design';
  if (/\b(logo|illustration|brand asset|image generation|create an? image|design an? (image|banner)|video production)\b/.test(text)) return 'creative';
  if (/\b(customer support|support ticket|user inquir|respond to|reply to|helpdesk)\b/.test(text)) return 'support';
  if (/\b(code|coding|architecture|repository|bug|refactor|unit test|deploy)\b/.test(text)) return 'engineering';
  if (d.category === 'operations' || d.category === 'data' || /\b(budget|resource usage|efficiency|reconciliation)\b/.test(text)) return 'operations';
  return 'marketing';
}

export const TEAM_THINKING = 'Use the shared Nucleas model engine. Quality matters more than speed. Plan and review with the configured paid reasoning route when permitted by the selected level; give Rogly workers narrow, specialist assignments for scouting, extraction, drafting and coding. Reuse verified evidence with its dates and sources. Inspect worker output; escalate a specific unresolved reasoning gap rather than repeating a large failed request. Never bypass review, spend limits, company scope or tool permissions.';
