/**
 * Declare each company's integrations (status `declared`) from the confirmed baseline and recorded stacks.
 *
 *   npx tsx --conditions=react-server scripts/declare-company-integrations.ts            # dry run
 *   npx tsx --conditions=react-server scripts/declare-company-integrations.ts --apply
 *
 * Runs for every organization that has owned/internal companies. Never modifies existing connections.
 */
import mongoose, { Types } from 'mongoose';
import { loadEnvLocal } from './loadEnvLocal';

loadEnvLocal();

async function main() {
  mongoose.set('autoIndex', false);
  const { default: connectDB } = await import('@/lib/db/mongodb');
  const { default: Client } = await import('@/lib/models/Client');
  const { IntegrationConnection } = await import('@/lib/models/Integration');
  const { planDeclaredConnections, applyDeclaredConnections } = await import('@/lib/integrations/declareConnections');

  const apply = process.argv.includes('--apply');
  await connectDB();

  const orgIds = (await Client.distinct('organizationId', { relationship: { $in: ['owned', 'internal'] } })) as Types.ObjectId[];
  if (apply) await IntegrationConnection.createIndexes();

  for (const orgId of orgIds) {
    if (!apply) {
      const plan = await planDeclaredConnections(orgId);
      console.log(`DRY RUN org ${orgId}: ${plan.items.length} connection(s), ${plan.items.filter((i) => !i.exists).length} new. Nothing written.\n`);
      let last = '';
      for (const item of plan.items) {
        if (item.companyName !== last) {
          console.log(item.companyName);
          last = item.companyName;
        }
        console.log(`  ${item.exists ? 'exists ' : 'declare'} ${item.provider.padEnd(8)} ${item.scope.padEnd(7)} ${item.source}`);
      }
      for (const [company, tools] of Object.entries(plan.unmappedTools)) {
        console.log(`  (no integration yet for ${company}: ${tools.join(', ')})`);
      }
    } else {
      const result = await applyDeclaredConnections(orgId);
      console.log(`APPLIED org ${orgId}: created ${result.created}, already existed ${result.existing}`);
    }
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
