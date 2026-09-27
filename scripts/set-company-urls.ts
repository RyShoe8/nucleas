/**
 * Set a company's production domain and/or dev URL.
 *
 *   npx tsx --conditions=react-server scripts/set-company-urls.ts --company=<clientId> --dev=<url> [--domain=<host>|--clear-domain] [--clear-urls] [--apply]
 *
 * Domain is reserved for the real production domain (used for SEO/Search Console setup);
 * preview hosts such as *.vercel.app belong in devUrl. Dry run unless --apply.
 */
import mongoose from 'mongoose';
import { loadEnvLocal } from './loadEnvLocal';

loadEnvLocal();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : undefined;
}

async function main() {
  mongoose.set('autoIndex', false);
  const { default: connectDB } = await import('@/lib/db/mongodb');
  const { default: Client } = await import('@/lib/models/Client');
  const { domainFromProject } = await import('@/lib/companies/ownedCompanies');

  const companyId = arg('company');
  const dev = arg('dev');
  const domainArg = arg('domain');
  const clearDomain = process.argv.includes('--clear-domain');
  const apply = process.argv.includes('--apply');

  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) throw new Error('--company=<clientId> is required');
  if (domainArg && clearDomain) throw new Error('Use either --domain or --clear-domain');

  const set: Record<string, string> = {};
  const unset: Record<string, ''> = {};
  const clearUrls = process.argv.includes('--clear-urls');
  if (dev) set.devUrl = new URL(/^https?:\/\//i.test(dev) ? dev : `https://${dev}`).origin;
  if (domainArg) {
    const host = domainFromProject({ url: domainArg });
    if (!host) throw new Error(`Invalid domain: ${domainArg}`);
    set.domain = host;
  }
  if (clearDomain) unset.domain = '';
  if (clearUrls) {
    unset.url = '';
    unset.liveUrl = '';
  }

  await connectDB();
  const company = await Client.findById(companyId).select('name domain devUrl urls').lean<{ name: string; domain?: string; devUrl?: string; urls?: string[] }>();
  if (!company) throw new Error(`Company ${companyId} not found`);

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${company.name}`);
  console.log(`  domain: ${company.domain ?? '-'} -> ${clearDomain ? '-' : set.domain ?? company.domain ?? '-'}`);
  if (clearUrls) console.log(`  urls: ${(company.urls ?? []).join(', ') || '-'} -> -`);
  console.log(`  devUrl: ${company.devUrl ?? '-'} -> ${set.devUrl ?? company.devUrl ?? '-'}`);

  if (apply) {
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (clearUrls) update.$set = { ...(update.$set as object), urls: [] };
    if (Object.keys(update).length) await Client.updateOne({ _id: companyId }, update);
    console.log('  done');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
