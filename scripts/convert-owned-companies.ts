/**
 * Convert top-level property projects into `owned` Companies.
 *
 *   npx tsx scripts/convert-owned-companies.ts                 # dry run, all candidates
 *   npx tsx scripts/convert-owned-companies.ts --only=<id,id>  # dry run, selected projects
 *   npx tsx scripts/convert-owned-companies.ts --only=<id,id> --apply
 *   --internal=<id,id>        mark as the operating company (relationship internal)
 *   --domain=<id>:<domain>    domain for a project with no URL (repeatable)
 *
 * --apply requires --only so nothing is converted by accident.
 */
import mongoose from 'mongoose';
import { loadEnvLocal } from './loadEnvLocal';

loadEnvLocal();

async function main() {
  // Dry runs must not write anything, including index builds on model compile.
  mongoose.set('autoIndex', false);
  const { default: connectDB } = await import('@/lib/db/mongodb');
  const { default: Project } = await import('@/lib/models/Project');
  const { planOwnedCompanyConversion, applyOwnedCompanyConversion } = await import('@/lib/companies/ownedCompanies');

  const apply = process.argv.includes('--apply');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;

  const internalArg = process.argv.find((a) => a.startsWith('--internal='));
  const relationships: Record<string, 'internal'> = {};
  for (const id of internalArg ? internalArg.slice('--internal='.length).split(',') : []) {
    if (id.trim()) relationships[id.trim()] = 'internal';
  }
  const domains: Record<string, string> = {};
  for (const arg of process.argv.filter((a) => a.startsWith('--domain='))) {
    const [id, domain] = arg.slice('--domain='.length).split(':');
    if (id && domain) domains[id.trim()] = domain.trim();
  }
  const overrides = { relationships, domains };

  if (apply && !only) {
    console.error('--apply requires --only=<projectId,...>');
    process.exit(1);
  }

  await connectDB();

  const ids =
    only ??
    (
      await Project.find(
        { projectType: { $in: ['internal', 'client'] }, $or: [{ clientId: { $exists: false } }, { clientId: null }] },
        { _id: 1 }
      )
        .sort({ name: 1 })
        .lean()
    ).map((p) => String(p._id));

  if (!apply) {
    const plan = await planOwnedCompanyConversion(ids, overrides);
    console.log(`DRY RUN: ${plan.length} project(s). Nothing written.\n`);
    for (const item of plan) {
      console.log(`${item.action.padEnd(26)} ${item.projectName} (${item.projectId}) [${item.relationship}]`);
      console.log(`  org: ${item.organizationId ?? "-"}   domain: ${item.domain ?? "-"}   copies: ${item.copiedFields.join(', ') || '-'}`);
      for (const note of item.notes) console.log(`  note: ${note}`);
    }
  } else {
    const { default: Client } = await import('@/lib/models/Client');
    await Client.createIndexes();
    const result = await applyOwnedCompanyConversion(ids, overrides);
    console.log(`APPLIED: created ${result.created}, attached ${result.attached}, unchanged ${result.unchanged}, skipped ${result.skipped}`);
    for (const item of result.items) {
      console.log(`${item.action.padEnd(26)} ${item.projectName} -> company ${item.companyId ?? '-'}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
