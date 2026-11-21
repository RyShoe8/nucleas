import { z } from 'zod';
import { TEAM_ROLES } from '@/lib/companies/teamRoles';
import { jobScheduleSchema } from '@/lib/jobs/schema';

/** A suggestion, not an executable agreement. The same Give work form completes it. */
export const workDraftFields = z.object({
    mode: z.enum(['once', 'repeating', 'ongoing']).optional(),
    role: z.enum(TEAM_ROLES).optional(),
    standard: z.string().max(2000).optional(),
    schedule: jobScheduleSchema.optional(),
});
export type WorkDraft = z.infer<typeof workDraftFields> & {
    companyId: string; companyName: string; outcome: string; assetIds?: string[];
    level?: 'free' | 'low' | 'medium' | 'high'; attachmentWarnings?: string[];
    created?: { kind: 'job' | 'build' | 'responsibility'; id: string };
    submission?: { token: string; at: string };
};
export function proposeWork(company: { id: string; name: string }, request: string, fields: z.infer<typeof workDraftFields> = {}): WorkDraft {
    const mode = fields.mode ?? (/\b(ongoing|until each|until every|quality threshold|keep improving)\b/i.test(request) ? 'ongoing'
        : /\b(every|daily|weekly|monthly|recurring|schedule|automate)\b/i.test(request) ? 'repeating' : 'once');
    return { ...workDraftFields.parse(fields), companyId: company.id, companyName: company.name, outcome: request.slice(0, 3000), mode, role: fields.role === 'tester' ? undefined : fields.role };
}
