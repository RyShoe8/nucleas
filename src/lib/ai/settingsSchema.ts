import { z } from 'zod';

const micros = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const platformAiSettingsSchema = z.object({
  planningEnabled: z.boolean(), remoteEnabled: z.boolean(), dispatchEnabled: z.boolean(),
  protocol: z.literal('openai-chat'),
  endpoint: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) &&
        !/\.(localhost|local|internal)$/i.test(url.hostname);
    } catch { return false; }
  }, 'Use a public HTTPS hostname without credentials, query parameters or fragments.'),
  model: z.string().trim().min(1).max(200),
  codingModel: z.string().trim().min(1).max(200).default('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ'),
  visualModel: z.string().trim().min(1).max(200).default('Qwen/Qwen3-VL-8B-Thinking-FP8'),
  noProviderFee: z.boolean(),
  dailyRequestLimit: z.number().int().min(1).max(10000).default(48),
  minimumIntervalSeconds: z.number().int().min(1).max(86400).default(300),
  maxOutputTokens: z.number().int().min(256).max(8192).default(3072),
  reservationMicros: micros, organizationLimitMicros: micros, projectLimitMicros: micros,
  /** Complimentary Nucleas credit ceiling (display / funding reference). */
  freePoolLimitMicros: micros.default(0),
  /** Complimentary Nucleas credit remaining (decremented on no-provider-fee settles). */
  freePoolRemainingMicros: micros.default(0),
}).strict().superRefine((value, ctx) => {
  if (value.projectLimitMicros > value.organizationLimitMicros) ctx.addIssue({ code: 'custom', message: 'Project ceiling cannot exceed organization ceiling.' });
  if (value.dispatchEnabled && (!value.planningEnabled || !value.remoteEnabled || value.reservationMicros <= 0 ||
    value.reservationMicros > value.projectLimitMicros)) ctx.addIssue({ code: 'custom', message: 'Enable planning and remote connection and configure positive budgets before processing.' });
  if (value.freePoolRemainingMicros > value.freePoolLimitMicros && value.freePoolLimitMicros > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Free pool remaining cannot exceed the free pool limit when a limit is set.',
      path: ['freePoolRemainingMicros'],
    });
  }
});
export type PlatformAiSettings = z.infer<typeof platformAiSettingsSchema>;
export const defaultPlatformAiSettings: PlatformAiSettings = {
  planningEnabled: true, remoteEnabled: false, dispatchEnabled: false, protocol: 'openai-chat',
  endpoint: 'https://llm.rogly.net/v1/chat/completions', model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
  codingModel: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', visualModel: 'Qwen/Qwen3-VL-8B-Thinking-FP8',
  noProviderFee: false, reservationMicros: 0, organizationLimitMicros: 0, projectLimitMicros: 0,
  dailyRequestLimit: 48, minimumIntervalSeconds: 300, maxOutputTokens: 3072,
  freePoolLimitMicros: 0, freePoolRemainingMicros: 0,
};
/**
 * An organization's two spending limits. limitMicros: its monthly budget (null = the platform's ceiling).
 * itemCapMicros: the most any single question, run, plan or code change may spend (null = the default).
 */
export const aiBudgetSettingsSchema = z.object({ limitMicros: micros.nullable(), itemCapMicros: micros.nullable().default(null), paused: z.boolean().default(false) }).strict();
export type AiBudgetSettings = z.infer<typeof aiBudgetSettingsSchema>;

// Decimal parsing avoids floating-point drift and rejects exponent/negative input.
export function dollarsToMicros(value: string): number {
  if (value.length > 24 || !/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('Enter a non-negative dollar amount with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large.');
  return Number(amount);
}
export function microsToDollars(value: number): string {
  return `${Math.floor(value / 1000000)}.${String(value % 1000000).padStart(6, '0')}`.replace(/\.?0+$/, '') || '0';
}
