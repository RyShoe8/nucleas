import 'server-only';
import { z } from 'zod';
import { CapabilityError, type CapabilityDefinition, type CapabilityRunContext } from '@/lib/capabilities/types';
import { ConnectorError, ListInputSchema, PublishInputSchema, PublicationReceiptSchema, websiteConnectorConfigSchema, type WebsiteConnectorConfig } from './contracts';
import { websiteAdapter } from './adapters';

/** Reusable definitions. Public callers always request approval; workflows may reuse an existing exact-payload review internally. */
export function websiteCapabilities(config: WebsiteConnectorConfig, beforeRun?: (context: CapabilityRunContext) => Promise<unknown>): CapabilityDefinition[] {
  const adapter = websiteAdapter(config);
  const common = { version: 1, domain: 'content', provider: 'website' };
  const checked = async (ctx: CapabilityRunContext, operation: () => Promise<unknown>) => {
    const current = websiteConnectorConfigSchema.safeParse(ctx.access.configuration);
    if (!current.success || JSON.stringify(current.data) !== JSON.stringify(config)) throw new CapabilityError('needs_setup', 'The website capability does not match the selected connection configuration.');
    await beforeRun?.(ctx);
    try { return await operation(); }
    catch (error) {
      if (error instanceof ConnectorError) throw new CapabilityError(error.code === 'publication_uncertain' ? 'uncertain' : error.code === 'forbidden' || error.code === 'disabled' ? 'needs_setup' : 'failed', error.message);
      throw error;
    }
  };
  const list: CapabilityDefinition<z.infer<typeof ListInputSchema>> = { ...common, id: 'content.items.list', title: 'Published website items', kind: 'read', risk: 'read', approval: 'auto', maxOutputBytes: 2_000_000, input: ListInputSchema,
      async run(ctx, input) { return { output: await checked(ctx, () => adapter.list(input, ctx.access.credential)), summary: 'Published website items collected' }; } };
  const publish: CapabilityDefinition<z.infer<typeof PublishInputSchema>> = { ...common, id: 'content.posts.publish', title: 'Publish approved website post', kind: 'write', risk: 'communication', approval: 'required', idempotent: true, input: PublishInputSchema,
      async run(ctx, input) { return { output: await checked(ctx, () => adapter.publish(input, ctx.access.credential)), summary: 'Website publication receipt received' }; },
      async verify(_ctx, input, result) { const receipt = PublicationReceiptSchema.safeParse(result.output); return receipt.success && receipt.data.idempotencyKey === input.idempotencyKey && new URL(receipt.data.url).origin === config.origin; } };
  const read: CapabilityDefinition<{ idempotencyKey: string }> = { ...common, id: 'content.posts.read', title: 'Check website publication', kind: 'read', risk: 'read', approval: 'auto', input: z.object({ idempotencyKey: z.string().min(1).max(300) }).strict(),
      async run(ctx, input) { return { output: await checked(ctx, () => adapter.read(input, ctx.access.credential)), summary: 'Website publication status checked' }; } };
  return [list, publish, read] as CapabilityDefinition[];
}
