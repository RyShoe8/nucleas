import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { siteSchema } from '../../roundups/sources';
import { websiteConnectorConfigSchema, ListInputSchema, PublishInputSchema, ListResultSchema, PublicationReceiptSchema,
  MissingReceiptSchema, ConnectorError, type WebsiteConnectorConfig, type ListInput, type PublishInput, type ListResult, type PublicationReceipt, type ReadResult } from '../contracts';
import { connectorTransport, type ConnectorDependencies } from '../transport';

/** Canonical optional receipt hash: sorted object keys, array order preserved. */
export function publicationPayloadHash(input: PublishInput): string {
  const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}` : JSON.stringify(value);
  return createHash('sha256').update(stable(input)).digest('hex');
}

export function websiteAdapter(config: WebsiteConnectorConfig, dependencies: ConnectorDependencies = {}) {
  const parsed = websiteConnectorConfigSchema.parse(config);
  const request = connectorTransport(parsed, dependencies);
  const legacy = parsed.adapter === 'playbound-roundup-v0';
  function permit(operation: WebsiteConnectorConfig['permissions'][number]) {
    if (!parsed.permissions.includes(operation)) throw new ConnectorError('forbidden', 'Connector permission is required.');
  }
  function receipt(value: unknown, idempotencyKey: string): PublicationReceipt {
    const result = PublicationReceiptSchema.parse(value);
    if (result.idempotencyKey !== idempotencyKey || new URL(result.url).origin !== parsed.origin)
      throw new ConnectorError('invalid_response', 'Receipt identity or origin does not match.');
    return result;
  }
  return {
    async list(input: ListInput, credential: string): Promise<ListResult> {
      permit('content.items.list'); const range = ListInputSchema.parse(input);
      if (legacy && range.cursor) throw new ConnectorError('forbidden', 'Legacy endpoint does not support cursors.');
      const value = await request('GET', { ...(legacy ? {} : { op: 'content.items.list', collection: parsed.collection }), ...range }, credential);
      if (legacy) {
        const data = siteSchema.parse(value);
        const baselines = [data.baseline, data.lastRoundup, data.previousRoundup].filter(v => v != null);
        const canonical = (b: NonNullable<typeof data.baseline>) => JSON.stringify({ boundary: b.coverageEnd ?? b.publishedAt,
          coveredIds: [...b.coveredIds].sort(), slug: b.slug });
        if (baselines.some(b => canonical(b) !== canonical(baselines[0]))) throw new ConnectorError('invalid_response', 'Ambiguous legacy baselines.');
        const b = baselines[0];
        const result = ListResultSchema.parse({ version: 1, items: data.games.map(game => ({ id: game.id, kind: 'game', title: game.title, url: game.url,
          publishedAt: game.publishedAt, publicationBasis: 'latest_published', description: game.description, fields: game })),
          ...(b ? { baseline: { ...b, coverageEnd: b.coverageEnd ?? null } } : {}), warnings: data.limitations });
        validateUrls(result); return result;
      }
      const envelope = z.object({ items: z.array(z.record(z.unknown())).max(2000) }).passthrough().parse(value);
      const names = ['id', 'kind', 'title', 'url', 'publishedAt', 'publicationBasis', 'description', 'fields'] as const;
      const items = envelope.items.map(item => Object.fromEntries(names.flatMap(name => {
        const source = parsed.fields?.[name] ?? name;
        if (source !== name && Object.hasOwn(item, name)) throw new ConnectorError('invalid_response', 'Ambiguous mapped item.');
        return Object.hasOwn(item, source) ? [[name, item[source]]] : [];
      })));
      const result = ListResultSchema.parse({ ...envelope, items });
      validateUrls(result);
      if (new Set(result.items.map(item => item.id)).size !== result.items.length) throw new ConnectorError('invalid_response', 'Duplicate item IDs.');
      return result;
    },
    async publish(input: PublishInput, credential: string): Promise<PublicationReceipt> {
      permit('content.posts.publish'); const draft = PublishInputSchema.parse(input);
      try {
        const value = await request('POST', legacy ? {} : { op: 'content.posts.publish' }, credential, draft);
        if (!legacy) {
          const result = receipt(value, draft.idempotencyKey);
          if (result.payloadHash && result.payloadHash !== publicationPayloadHash(draft)) throw new ConnectorError('invalid_response', 'Receipt content hash does not match.');
          return result;
        }
        const { post } = z.object({ created: z.boolean(), post: z.object({ sourceKey: z.literal(`nucleas:roundup:${draft.idempotencyKey}`),
          publishedAt: z.string().datetime({ offset: true }), url: z.string().url(), title: z.literal(draft.title), summary: z.literal(draft.summary),
          bodyMarkdown: z.literal(draft.bodyMarkdown), coverageStart: z.string().datetime({ offset: true }), coverageEnd: z.string().datetime({ offset: true }), coveredIds: z.array(z.string()).max(2000) }) }).parse(value);
        if (Date.parse(post.coverageStart) !== Date.parse(draft.coverageStart) || Date.parse(post.coverageEnd) !== Date.parse(draft.coverageEnd)
          || JSON.stringify([...post.coveredIds].sort()) !== JSON.stringify([...draft.coveredIds].sort())) throw new Error('Receipt mismatch');
        return receipt({ version: 1, idempotencyKey: draft.idempotencyKey, externalId: post.sourceKey, url: post.url, status: 'published' }, draft.idempotencyKey);
      } catch { throw new ConnectorError('publication_uncertain', 'Publication is unconfirmed; reconcile using the same idempotency key.'); }
    },
    async read(input: { idempotencyKey: string }, credential: string): Promise<ReadResult> {
      permit('content.posts.read');
      const { idempotencyKey } = z.object({ idempotencyKey: z.string().min(1).max(300) }).strict().parse(input);
      // Existing legacy route has no durable read protocol. Never mistake its list response for absence.
      if (legacy) throw new ConnectorError('forbidden', 'Legacy endpoint does not support publication reads.');
      const value = await request('GET', { op: 'content.posts.read', idempotencyKey }, credential);
      const missing = MissingReceiptSchema.safeParse(value);
      if (missing.success) {
        if (missing.data.idempotencyKey !== idempotencyKey) throw new ConnectorError('invalid_response', 'Receipt key does not match.');
        return missing.data;
      }
      return receipt(value, idempotencyKey);
    },
  };
  function validateUrls(result: ListResult) {
    const urls = [...result.items.map(item => item.url), ...(result.baseline?.url ? [result.baseline.url] : [])];
    if (urls.some(value => { const u = new URL(value); return u.origin !== parsed.origin || !!u.username || !!u.password; }))
      throw new ConnectorError('invalid_response', 'Content URL does not match configured origin.');
  }
}
