import { z } from 'zod';

/**
 * The shape of a job as Nucleas designs it, and the checks every run's result must pass.
 * Nothing here is company-specific: the designer fills it in by investigating each company.
 */

export const JOB_CATEGORIES = ['research', 'content', 'marketing', 'data', 'outreach', 'operations'] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

/**
 * Ways results can be delivered, least access first. The designer must pick the lowest that works.
 * Only 'nucleas' and 'handoff' run today; the others are proposed with their one-time setup.
 */
export const DELIVERY_METHODS = ['nucleas', 'handoff', 'integration', 'pull_request', 'intake_endpoint', 'browser'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const RUNNABLE_DELIVERY: DeliveryMethod[] = ['nucleas', 'handoff'];

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  nucleas: 'Kept in Nucleas',
  handoff: 'Handed to a person to apply',
  integration: 'Through a connected integration',
  pull_request: 'Pull request through Building',
  intake_endpoint: "Signed intake endpoint in the company's app",
  browser: 'Browser on the VPS (people handle logins and CAPTCHAs)',
};

export const FIELD_TYPES = ['text', 'long_text', 'number', 'date', 'url', 'list', 'boolean'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'lower_snake_case');

export const jobFieldSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES).catch('text'),
  required: z.boolean().default(false),
  description: z.string().max(300).default(''),
});
export type JobField = z.infer<typeof jobFieldSchema>;

export const jobQuestionSchema = z.object({
  id: key,
  question: z.string().min(5).max(500),
  /** Why Nucleas needs this answered (what it found and could not decide). */
  why: z.string().max(500).default(''),
  options: z
    .array(z.object({ id: key, label: z.string().min(1).max(160), detail: z.string().max(400).default('') }))
    .max(5)
    .default([]),
  /** The option Nucleas recommends, if any. */
  recommended: z.string().max(40).optional(),
});
export type JobQuestion = z.infer<typeof jobQuestionSchema>;

export const jobScheduleSchema = z.object({
  kind: z.enum(['once', 'daily', 'weekly', 'monthly']).catch('once'),
  /** Local time "HH:MM" for repeating jobs. */
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  /** IANA timezone used to turn the local schedule into an exact run time. */
  timezone: z.string().min(1).max(100).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
});
export type JobSchedule = z.infer<typeof jobScheduleSchema>;

/** What the designer must return. */
export const jobDesignSchema = z.object({
  /** First-party skill/template that owns this design, when applicable. */
  skill: z.enum(['link_building', 'seo_brief', 'marketing_plan', 'brand_voice', 'social_media', 'ai_citations', 'property_overview']).optional(),
  title: z.string().min(3).max(120),
  category: z.enum(JOB_CATEGORIES).catch('research'),
  /** Exact, self-contained instructions for each run. */
  instructions: z.string().min(20).max(6000),
  fields: z.array(jobFieldSchema).min(1).max(30),
  /** What counts as a trustworthy source for this work. */
  sourcePolicy: z.string().max(1500).default('Use reputable, primary sources and cite each one.'),
  delivery: z.object({
    method: z.enum(DELIVERY_METHODS).catch('nucleas'),
    /** Where exactly results go and how, in plain words. */
    detail: z.string().max(1500).default(''),
    /** One-time setup needed before real runs (e.g. a pull request adding a signed intake endpoint). */
    setupSteps: z.array(z.string().max(500)).max(10).default([]),
  }),
  schedule: jobScheduleSchema.default({ kind: 'once' }),
  /** How many records one run should produce (e.g. 1 new link per day). */
  recordsPerRun: z.number().int().min(1).max(100).default(1),
  /** Safeguards specific to this job, beyond the ones every job has. */
  safeguards: z.array(z.string().max(300)).max(10).default([]),
  recommendedCompletion: z.enum(['review', 'automatic']).catch('review'),
  /** What the investigation found (repository, integrations, guidelines) — shown to the person. */
  findings: z.array(z.string().max(500)).max(12).default([]),
  /** Questions only the person can answer. Empty when the design is complete. */
  questions: z.array(jobQuestionSchema).max(6).default([]),
});
export type JobDesign = z.infer<typeof jobDesignSchema>;

/** What a run must return. */
export const jobRunOutputSchema = z.object({
  records: z.array(z.object({ values: z.record(z.string(), z.unknown()), sources: z.array(z.string().max(2000)).max(20).default([]) })).max(100),
  summary: z.string().max(4000).default(''),
  /** Anything the run could not find or verify. */
  gaps: z.array(z.string().max(500)).max(20).default([]),
});
export type JobRunOutput = z.infer<typeof jobRunOutputSchema>;

export interface RecordIssue {
  record: number;
  field?: string;
  problem: string;
}

function validValue(type: FieldType, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  switch (type) {
    case 'number':
      return typeof value === 'number' ? Number.isFinite(value) : /^-?[\d,]+(\.\d+)?$/.test(String(value).trim());
    case 'date':
      return !Number.isNaN(Date.parse(String(value)));
    case 'url':
      try {
        return ['http:', 'https:'].includes(new URL(String(value)).protocol);
      } catch {
        return false;
      }
    case 'list':
      return Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0;
    case 'boolean':
      return typeof value === 'boolean' || /^(true|false|yes|no)$/i.test(String(value));
    default:
      return String(value).trim().length > 0;
  }
}

/**
 * Deterministic checks on a run's records: required fields present and well-formed, every record
 * sourced. Any issue sends an automatic job's run to review instead of completing it.
 */
export function checkRecords(fields: JobField[], output: JobRunOutput): RecordIssue[] {
  const issues: RecordIssue[] = [];
  if (!output.records.length) issues.push({ record: -1, problem: 'The run produced no records.' });
  output.records.forEach((r, i) => {
    for (const f of fields) {
      const value = r.values[f.key];
      const present = value !== null && value !== undefined && value !== '';
      if (f.required && !present) issues.push({ record: i, field: f.key, problem: `${f.label} is missing.` });
      else if (present && !validValue(f.type, value)) issues.push({ record: i, field: f.key, problem: `${f.label} is not a valid ${f.type.replace('_', ' ')}.` });
    }
    const sources = r.sources.filter((s) => /^https?:\/\//.test(s));
    if (!sources.length) issues.push({ record: i, problem: 'No source link for this record.' });
  });
  return issues;
}
