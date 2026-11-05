import { z } from 'zod';
import { browserNavigate } from '@/lib/ai/tools/browserClient';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

export const prospectQualification = z.object({
    team_size: z.number().int().min(1).max(25),
    team_source: z.string().url(),
    team_quote: z.string().min(20).max(1000),
    growth_source: z.string().url(),
    growth_quote: z.string().min(30).max(1000),
    growth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    website: z.string().url(),
    social: z.string().regex(/^https:\/\/(?:bsky\.app\/profile\/|(?:www\.)?facebook\.com\/)[\w.-]+\/?$/),
});

/** Open primary evidence before a reviewer decides whether its meaning supports the claims. */
export async function qualifySignatureProspect(values: Record<string, unknown>, sources: string[], excluded: string[], needsBlog: boolean) {
    const parsed = prospectQualification.safeParse(values);
    if (!parsed.success) {
        const missing = parsed.error.issues.filter(issue => issue.code === 'invalid_type' && issue.received === 'undefined').map(issue => issue.path.join('.'));
        const invalid = parsed.error.issues.filter(issue => !(issue.code === 'invalid_type' && issue.received === 'undefined')).map(issue => issue.path.join('.') + ': ' + issue.message);
        throw new Error([missing.length ? 'Research omitted required evidence fields: ' + missing.join(', ') + '.' : '', ...invalid].filter(Boolean).join(' '));
    }
    const candidate = parsed.data;
    const host = (raw: string) => assertSafePublicHttpsUrl(raw).hostname.toLowerCase().replace(/^www\./, '');
    const domain = host(candidate.website);
    if (excluded.some(raw => {
        const owned = host(raw.startsWith('https://') ? raw : `https://${raw}`);
        return domain === owned || domain.endsWith(`.${owned}`);
    })) throw new Error('Choose an external small company. Owned properties are excluded.');
    const dated = Date.parse(`${candidate.growth_date}T12:00:00Z`);
    if (!Number.isFinite(dated) || dated > Date.now() + 86400000 || dated < Date.now() - 366 * 86400000) throw new Error('Supply a growth announcement from the last year.');
    for (const url of [candidate.team_source, candidate.growth_source]) {
        if (host(url) !== domain) throw new Error('Team and growth evidence must come from the prospect’s official site.');
    }
    const required = ['team_source', 'growth_source', 'person_source', 'contact_source', 'cta_url', ...(needsBlog ? ['feed'] : [])];
    for (const key of required) {
        const url = String(values[key] ?? '');
        assertSafePublicHttpsUrl(url);
        if (!sources.some(source => source.replace(/\/$/, '') === url.replace(/\/$/, ''))) throw new Error(`Cite the exact ${key} URL in sources.`);
    }
    const urls = [...new Set([candidate.team_source, candidate.growth_source, String(values.person_source), String(values.contact_source)])];
    const pages = await Promise.all(urls.map(async url => {
        const page = await browserNavigate(url);
        if (host(page.url) !== domain) throw new Error('Primary evidence redirected outside the prospect website.');
        return { url, text: page.text };
    }));
    const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [url, quote] of [[candidate.team_source, candidate.team_quote], [candidate.growth_source, candidate.growth_quote]]) {
        if (!normalize(pages.find(page => page.url === url)?.text ?? '').includes(normalize(quote))) throw new Error('The quoted primary evidence was not found on the cited page. Research another candidate.');
    }
    return pages.map(page => `Opened primary source: ${page.url}\n${page.text.slice(0, 6500)}`).join('\n\n');
}
