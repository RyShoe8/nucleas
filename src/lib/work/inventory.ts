import 'server-only';
import { Types } from 'mongoose';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { casinoIntake } from '@/lib/casinoDiscovery/intake';

/** Read the canonical catalog. Publishing/editing review pages is a separate capability. */
export async function readWorkInventory(viewer: CompanyViewer, companyId: string) {
    const company = await getCompanyProfile(viewer, companyId);
    if (!company) throw Error('Company not found.');
    if (!/^(?:https?:\/\/)?(?:www\.)?frugalgambler\.club\/?$/i.test(company.domain ?? '')) throw Error('No catalog adapter is configured for this company. Enter its target pages explicitly.');
    const intake = await casinoIntake(viewer.organizationId, new Types.ObjectId(companyId));
    if (new URL(intake.origin).hostname.replace(/^www\./, '') !== 'frugalgambler.club') throw Error('The connected admin must belong to this company.');
    const catalog = await intake.inventory();
    if (!Array.isArray(catalog.casinos)) throw Error('The admin did not return a complete casino inventory.');
    const seen = new Set<string>();
    const targets = catalog.casinos.flatMap(c => {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(c.slug) || seen.has(c.slug)) return [];
        seen.add(c.slug);
        return [{ key: `casino:${c.slug}`, name: c.name, url: `${intake.origin}/casinos/${encodeURIComponent(c.slug)}`, status: c.status }];
    });
    return { source: `${intake.origin}/admin/intake/casinos`, fetchedAt: new Date().toISOString(), targets };
}
