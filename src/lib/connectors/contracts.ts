import { z } from 'zod';
import { assertSafePublicHttpsUrl } from '../ai/tools/ssrf';

const text = z.string().min(1).max(300);
const date = z.string().datetime({ offset: true });
const url = z.string().url().max(2000);
const ids = z.array(text).max(2000);
const key = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100)
  .refine(v => !['__proto__', 'prototype', 'constructor'].includes(v));
export const WebsiteConnectorConfigSchema = z.object({
  version: z.literal(1), adapter: z.enum(['website-v1', 'playbound-roundup-v0']),
  origin: z.string().max(2000).refine(value => {
    try { const u = assertSafePublicHttpsUrl(value); return value === u.origin; } catch { return false; }
  }, 'Expected a canonical public HTTPS origin'),
  endpointPath: z.string().max(1000).default('/api/nucleas/v1').refine(v =>
    /^\/(?!\/)[A-Za-z0-9/_-]+$/.test(v) && !v.includes('//')),
  enabled: z.boolean().default(false),
  permissions: z.array(z.enum(['content.items.list', 'content.posts.publish', 'content.posts.read'])).max(3),
  collection: text,
  // Canonical item property -> source property. No paths, expressions, or coercion.
  fields: z.object({ id: key.optional(), kind: key.optional(), title: key.optional(), url: key.optional(),
    publishedAt: key.optional(), publicationBasis: key.optional(), description: key.optional(), fields: key.optional() }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  const names = ['id', 'kind', 'title', 'url', 'publishedAt', 'publicationBasis', 'description', 'fields'];
  const mapped = names.map(n => v.fields?.[n as keyof NonNullable<typeof v.fields>] ?? n);
  if (new Set(mapped).size !== mapped.length) ctx.addIssue({ code: 'custom', message: 'Ambiguous field mapping' });
  if (v.adapter === 'playbound-roundup-v0' && v.fields) ctx.addIssue({ code: 'custom', message: 'Legacy mappings are fixed' });
});
export const websiteConnectorConfigSchema = WebsiteConnectorConfigSchema;
export type WebsiteConnectorConfig = z.infer<typeof WebsiteConnectorConfigSchema>;
export const ListInputSchema = z.object({ since: date, until: date, cursor: text.optional() }).strict()
  .refine(v => Date.parse(v.since) < Date.parse(v.until), 'Invalid coverage window');
export type ListInput = z.infer<typeof ListInputSchema>;
export const PublishInputSchema = z.object({ idempotencyKey: text, title: text, summary: z.string().max(8000),
  bodyMarkdown: z.string().min(1).max(100000), coverageStart: date, coverageEnd: date, coveredIds: ids }).strict()
  .refine(v => Date.parse(v.coverageStart) < Date.parse(v.coverageEnd), 'Invalid coverage window');
export type PublishInput = z.infer<typeof PublishInputSchema>;
export const ItemSchema = z.object({ id: text, kind: text, title: text, url, publishedAt: date.nullable(),
  publicationBasis: z.enum(['first_published', 'latest_published', 'observed', 'unknown']),
  description: z.string().max(8000).optional(), fields: z.record(z.unknown()) });
export const BaselineSchema = z.object({ publishedAt: date.nullable(), coverageEnd: date.nullable(), coveredIds: ids,
  slug: text.optional(), url: url.optional() });
export const ListResultSchema = z.object({ version: z.literal(1), items: z.array(ItemSchema).max(2000),
  nextCursor: text.nullish(), baseline: BaselineSchema.optional(), warnings: z.array(z.string().max(2000)).max(30) });
export type ListResult = z.infer<typeof ListResultSchema>;
export const PublicationReceiptSchema = z.object({ version: z.literal(1), idempotencyKey: text,
  externalId: text, url, status: z.literal('published'), payloadHash: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;
export const MissingReceiptSchema = z.object({ version: z.literal(1), status: z.literal('missing'), idempotencyKey: text }).strict();
export type ReadResult = PublicationReceipt | z.infer<typeof MissingReceiptSchema>;
export class ConnectorError extends Error {
  constructor(public readonly code: 'disabled' | 'forbidden' | 'unsafe' | 'transport' | 'invalid_response' | 'publication_uncertain', message: string) { super(message); this.name = 'ConnectorError'; }
}
