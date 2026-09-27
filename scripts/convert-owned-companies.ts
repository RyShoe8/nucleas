/**
 * Convert top-level property projects into `owned` Companies.
 *
 *   npx tsx scripts/convert-owned-companies.ts                 # dry run, all candidates
 *   npx tsx scripts/convert-owned-companies.ts --only=<id,id>  # dry run, selected projects
 *   npx tsx scripts/convert-owned-companies.ts --only=<id,id> --apply
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
    const plan = await planOwnedCompanyConversion(ids);
    console.log(`DRY RUN: ${plan.length} project(s). Nothing written.\n`);
    for (const item of plan) {
      console.log(`${item.action.padEnd(26)} ${item.projectName} (${item.projectId})`);
      console.log(`  domain: ${item.domain ?? '-'}   copies: ${item.copiedFields.join(', ') || '-'}`);
      for (const note of item.notes) console.log(`  note: ${note}`);
    }
  } else {
    const { default: Client } = await import('@/lib/models/Client');
    await Client.createIndexes();
    const result = await applyOwnedCompanyConversion(ids);
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
