import { z } from 'zod';
import { TEAM_ROLES } from '@/lib/companies/teamRoles';
import { jobScheduleSchema, type JobDesign } from '@/lib/jobs/schema';

export const workAgreementSchema = z.object({
    mode: z.enum(['once', 'repeating', 'ongoing']),
    level: z.enum(['free', 'low', 'medium', 'high']).optional(),
    outcome: z.string().trim().min(10).max(3000),
    standard: z.string().trim().min(10).max(2000),
    role: z.enum(TEAM_ROLES).default('marketing'),
    assignedMemberId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
    assetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(6).default([]),
    sources: z.array(z.string().url().max(2000).refine(url => /^https?:\/\//i.test(url), 'Use an HTTP or HTTPS source.')).max(12).default([]),
    schedule: jobScheduleSchema.optional(),
    targets: z.array(z.string().url().max(2000)).max(500).default([]),
    threshold: z.number().int().min(1).max(100).default(85),
    maxPending: z.number().int().min(1).max(10).default(3),
    gates: z.array(z.string().trim().min(5).max(300)).max(12).default([]),
}).superRefine((value, ctx) => {
    if (value.role === 'tester') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role'], message: 'Tester is reserved and inactive.' });
    if (value.mode === 'ongoing' && (!value.targets.length || !value.gates.length)) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Add at least one target page and one mandatory check.' });
    if (value.mode === 'repeating' && (!value.schedule || value.schedule.kind === 'once')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Choose a repeating schedule.' });
    if (value.targets.some(url => !/^https?:\/\//i.test(url))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets'], message: 'Targets must be HTTP or HTTPS pages.' });
    if (value.mode === 'repeating') {
        const s = value.schedule;
        if (s?.kind === 'weekly' && !(s.weekdays?.length || s.weekday !== undefined)) ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Choose at least one weekday.' });
        if (s?.time && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Choose a valid local time.' });
        try { if (!s?.timezone) throw Error(); new Intl.DateTimeFormat('en', { timeZone: s.timezone }); } catch { ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Choose a valid timezone.' }); }
    }
});
export type WorkAgreement = z.infer<typeof workAgreementSchema>;
export function agreementBrief(agreement: WorkAgreement) {
    return `${agreement.outcome}\n\nDefinition of done: ${agreement.standard}\nWork mode: ${agreement.mode}.\nAuthority: research and draft preparation only. External changes require separate approval.\n${agreement.schedule ? `Agreed schedule (do not reinterpret): ${JSON.stringify(agreement.schedule)}` : 'Run once; do not invent a repeating schedule.'}`;
}
export function agreementRequirements(agreement: Pick<WorkAgreement, 'standard' | 'gates'>): string {
    return `Required standard: ${agreement.standard}\n${agreement.gates.map(g => `Required check: ${g}`).join('\n')}`;
}
/** User decisions constrain the planner; a model may not create a schedule or broaden authority. */
export function constrainDesign(design: JobDesign, agreement: WorkAgreement, context: { responsibility?: boolean } = {}): JobDesign {
    // Preserve the complete human agreement before spending the remaining space on model instructions.
    const requirements = agreementRequirements(agreement);
    return { ...design, quality: context.responsibility || agreement.mode === 'ongoing' || design.category === 'content' ? 'in_depth' : design.quality, schedule: agreement.mode === 'repeating' ? agreement.schedule! : { kind: 'once' },
        instructions: `${requirements}\n\n${design.instructions.slice(0, Math.max(0, 6000 - requirements.length - 2))}`,
        recommendedCompletion: 'review', delivery: { method: 'nucleas', detail: 'Save the draft and evidence for review. External application is a separate decision.', setupSteps: [] },
        skill: undefined,
        safeguards: ['Never publish or alter external systems.', 'A draft is not proof that the live target meets the standard.', ...design.safeguards].slice(0, 10) };
}
