import { Types } from 'mongoose';
import { z } from 'zod';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { normalizeProductionDomain } from '@/lib/companies/productionDomain';

/**
 * Adds a company from the Companies window.
 * - owned: a business we run. It gets a hub project (the place its tasks, content and repository live) and the
 *   company profile is read from that project.
 * - client: someone we work for. It gets the same client-admin project the Clients page creates.
 */
export const createCompanySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name of at least 2 characters.').max(120, 'Names can be up to 120 characters.'),
  domain: z.string().trim().max(500).optional().default(''),
  relationship: z.enum(['owned', 'client']),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

const DEFAULT_COLOR = '#3b82f6';
type Result = { ok: true; id: string; name: string } | { ok: false; status: number; error: string };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function createCompany(viewer: CompanyViewer, raw: unknown): Promise<Result> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can add companies.' };
  const parsed = createCompanySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  const { name, relationship } = parsed.data;
  const domainResult = normalizeProductionDomain(parsed.data.domain);
  if (!domainResult.ok) return { ok: false, status: 400, error: domainResult.error };
  const domain = domainResult.domain;

  const organizationId = viewer.organizationId;
  if (await Client.exists({ organizationId, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } })) {
    return { ok: false, status: 409, error: `You already have a company named ${name}.` };
  }
  if (domain && (await Client.exists({ organizationId, domain }))) {
    return { ok: false, status: 409, error: `${domain} already belongs to another company.` };
  }

  const userId = new Types.ObjectId(viewer.userId);
  const url = domain ? `https://${domain}` : undefined;
  const common = { name, color: DEFAULT_COLOR, category: 'generic', status: 'planning', userId, ...(url ? { url, liveUrl: url } : {}) };

  if (relationship === 'client') {
    const client = await Client.create({ organizationId, name, domain: domain ?? undefined, color: DEFAULT_COLOR, status: 'active', relationship: 'client', userIds: [], assignedToEmployeeIds: [] });
    await Project.create({ userId, name, projectType: 'client-admin', clientId: client._id, status: 'planning', category: 'generic', color: DEFAULT_COLOR });
    return { ok: true, id: String(client._id), name };
  }

  const hub = await Project.create({ ...common, projectType: 'internal' });
  try {
    const company = await Client.create({ organizationId, name, domain: domain ?? undefined, color: DEFAULT_COLOR, status: 'active', relationship: 'owned', hubProjectId: hub._id, userIds: [userId], assignedToEmployeeIds: [] });
    await Project.updateOne({ _id: hub._id }, { $set: { clientId: company._id } });
    return { ok: true, id: String(company._id), name };
  } catch (error) {
    // Never leave an orphaned hub project behind.
    await Project.deleteOne({ _id: hub._id }).catch(() => undefined);
    throw error;
  }
}
