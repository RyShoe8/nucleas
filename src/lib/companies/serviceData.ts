import 'server-only';
import { lookup } from 'node:dns/promises';
import { Schema, models, model, Types } from 'mongoose';
import { assertSafePublicHttpsUrl, isSafePublicHost } from '@/lib/ai/tools/ssrf';
import { pinnedHttpsJson } from '@/lib/connectors/transport';
import { adminSessionFor } from './adminAccount';
import { domainMatches } from './sessionCookies';
import { serviceReportSchema, type ServiceReport } from './serviceReport';

const schema = new Schema({ organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true }, report: Schema.Types.Mixed }, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1 }, { unique: true });
const ServiceData = models.CompanyServiceData || model('CompanyServiceData', schema);
export async function serviceCompanyIds(): Promise<Types.ObjectId[]> { return ServiceData.distinct('companyId'); }
export async function readServiceData(organizationId: Types.ObjectId, companyId: string): Promise<ServiceReport | null> {
  const row = await ServiceData.findOne({ organizationId, companyId }).lean<{ report: unknown }>();
  return row ? serviceReportSchema.parse(row.report) : null;
}
export async function refreshServiceData(organizationId: Types.ObjectId, companyId: string) {
  const session = await adminSessionFor(organizationId, companyId);
  if (!session) throw new Error('Connect the company admin account first.');
  const url = assertSafePublicHttpsUrl(new URL('/api/admin/nucleas/service-metrics', session.baseUrl).href);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isSafePublicHost(a.address))) throw new Error('Site must resolve to public addresses.');
  const address = addresses.find(a => a.family === 4);
  if (!address) throw new Error('Site requires a public IPv4 address.');
  const cookies = session.cookies.filter(c => domainMatches(c.domain, url.hostname)
    && (c.expires <= 0 || c.expires > Date.now() / 1000)
    && (url.pathname === c.path || url.pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`))
    && /^[!#$%&'*+.^_`|~\w-]+$/.test(c.name) && !/[\r\n;]/.test(c.value));
  if (!cookies.length) throw new Error('No usable admin cookies. Reconnect the admin account.');
  const report = serviceReportSchema.parse(await pinnedHttpsJson(url, address.address, 'GET', { accept: 'application/json', cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') }, ''));
  await ServiceData.updateOne({ organizationId, companyId }, { $set: { report } }, { upsert: true });
  return report;
}
