import { z } from 'zod';
import { isIdeDirectMode, normalizeIdeChatMode } from '@/lib/ide/modes';
import { teamMessageRoleSchema } from '@/lib/ai/teamWorkspace';
import { COST_LEVELS } from '@/lib/ai/engine/select';

/** Request body for IDE chat (worker modes + Direct). */
export const ideChatSchema = z
  .object({
    mode: z.string().transform((value, ctx) => {
      const normalized = normalizeIdeChatMode(value);
      if (!normalized) {
        ctx.addIssue({ code: 'custom', message: 'Invalid IDE chat mode.' });
        return z.NEVER;
      }
      return normalized;
    }),
    text: z.string().trim().min(1).max(6000),
    history: z
      .array(
        z
          .object({
            role: teamMessageRoleSchema,
            text: z.string().max(6000),
          })
          .strict()
      )
      .max(20)
      .default([]),
    modelProfileId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    model: z.string().trim().min(1).max(200).optional(),
    interactionMode: z.enum(['chat', 'plan', 'build']).default('chat'),
    /** AI engine cost level; omitted = the organization default. */
    level: z.enum(COST_LEVELS).optional(),
    clientRequestId: z.string().trim().max(80).optional(),
    /** When true, response is application/x-ndjson with stage + turn events. */
    stream: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (isIdeDirectMode(value.mode)) {
      if (!value.modelProfileId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Direct mode requires a company credential.',
          path: ['modelProfileId'],
        });
      }
      if (!value.model?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Direct mode requires a model id.',
          path: ['model'],
        });
      }
    }
  });

export type IdeChatInput = z.infer<typeof ideChatSchema>;
