import { z } from 'zod';
import { browserFetch, browserNavigate } from '@/lib/ai/tools/browserClient';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

export const prospectQualification = z.object({
    team_size: z.number().int().min(1).max(25),
    team_source: z.string().url(),
    team_quote: z.string().min(10).max(1000),
    growth_source: z.string().url(),
    growth_quote: z.string().min(30).max(1000),
    growth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    website: z.string().url(),
    social: z.string().regex(/^https:\/\/bsky\.app\/profile\/[\w.-]+\/?$/, 'Use the company Bluesky profile.'),
});

const NOT_A_PUBLICATION = new Set(['www', 'cdn', 'open', 'on', 'app', 'help', 'support', 'blog']);

/** Hosted blogs a page refers to by their own address, like company.substack.com. A shared host on its own proves nothing. */
export function publishingHostsIn(html: string): Set<string> {
    const hosts = new Set<string>();
    for (const match of html.matchAll(/\b([a-z0-9][a-z0-9-]*)\.(substack\.com|ghost\.io|beehiiv\.com|medium\.com|tumblr\.com|wordpress\.com|blogspot\.com|buttondown\.email)\b/gi)) {
        if (!NOT_A_PUBLICATION.has(match[1].toLowerCase())) hosts.add(match[0].toLowerCase());
    }
    return hosts;
}

/**
 * A company's own hosted blog counts as its official site when its homepage points to that exact address. News coverage
 * and other sites a homepage links to never count. Raw HTML is read because such blogs are often embedded, not linked.
 */
export async function officialPublishingHosts(website: string): Promise<Set<string>> {
    try {
        return publishingHostsIn((await browserFetch(website)).body);
    } catch (error) {
        console.warn('[signature] could not read the homepage for its hosted blog', error instanceof Error ? error.message : 'unknown');
        return new Set();
    }
}

/** Whether a page really contains a quote. Words must match in order; quote marks, dashes and formatting differences do not matter. */
export function quoteOnPage(pageText: string, quote: string): boolean {
    const words = (text: string) => ` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const wanted = words(quote);
    return wanted.trim().length > 0 && words(pageText).includes(wanted);
}

/** Code decides this, so a model cannot apply a stricter rule than the job's: anything goes unless the quote itself states more than 25. */
export function teamEvidenceProblem(quote: string): string | null {
    const stated = [...quote.matchAll(/(?:team of|staff of)\s+(\d[\d,]*)|(\d[\d,]*)\s*\+?\s*(?:-\s*person|person|people team|employees|staff|team members|teammates|people on)\b/gi)]
        .map(match => Number((match[1] ?? match[2]).replace(/,/g, '')));
    const largest = stated.length ? Math.max(...stated) : 0;
    return largest > 25 ? `The team evidence says ${largest} people, over the limit of 25.` : null;
}

/** Open primary evidence before a reviewer decides whether its meaning supports the claims. */
export async function qualifySignatureProspect(values: Record<string, unknown>, sources: string[], excluded: string[], needsBlog: boolean) {
    const parsed = prospectQualification.safeParse(values);
    if (!parsed.success) {
        const missing = parsed.error.issues.filter(issue => issue.code === 'invalid_type' && issue.received === 'undefined').map(issue => issue.path.join('.'));
        const invalid = parsed.error.issues.filter(issue => !(issue.code === 'invalid_type' && issue.received === 'undefined')).map(issue => issue.path.join('.') + ': ' + issue.message);
        throw new Error([missing.length ? 'Research omitted required evidence fields: ' + missing.join(', ') + '.' : '', ...invalid].filter(Boolean).join(' '));
    }
    // Checked here, before the pages are opened, so a post with a link gets the retry.
    if (/https?:\/\/|\bwww\.|(?<!@)\btailnote\.io\b/i.test(String(values.post ?? ''))) throw new Error('Leave every link out of the social post. It starts a conversation, and the link can wait until they reply.');
    const candidate = parsed.data;
    const teamProblem = teamEvidenceProblem(candidate.team_quote);
    if (teamProblem) throw new Error(teamProblem);
    if (/\[[^\]]*\]/.test(String(values.post ?? ''))) throw new Error('Write the social post as finished text, with no bracketed placeholders or labels.');
    const host = (raw: string) => assertSafePublicHttpsUrl(raw).hostname.toLowerCase().replace(/^www\./, '');
    const domain = host(candidate.website);
    if (excluded.some(raw => {
        const owned = host(raw.startsWith('https://') ? raw : `https://${raw}`);
        return domain === owned || domain.endsWith(`.${owned}`);
    })) throw new Error('Choose an external small company. Owned properties are excluded.');
    const dated = Date.parse(`${candidate.growth_date}T12:00:00Z`);
    if (!Number.isFinite(dated) || dated > Date.now() + 86400000 || dated < Date.now() - 366 * 86400000) throw new Error('Supply a growth announcement from the last year.');
    const evidence = [candidate.team_source, candidate.growth_source, String(values.person_source ?? ''), String(values.contact_source ?? '')].filter(Boolean);
    const official = evidence.some(url => host(url) !== domain) ? await officialPublishingHosts(candidate.website) : new Set<string>();
    const isOfficial = (url: string) => host(url) === domain || official.has(host(url));
    for (const url of [candidate.team_source, candidate.growth_source]) {
        if (!isOfficial(url)) throw new Error('Team and growth evidence must come from the prospect’s official site.');
    }
    const required = ['team_source', 'growth_source', 'person_source', 'contact_source', 'cta_url', ...(needsBlog ? ['feed'] : [])];
    for (const key of required) {
        const url = String(values[key] ?? '').trim();
        if (!url) throw new Error(`Missing ${key}.`);
        try { assertSafePublicHttpsUrl(url); } catch { throw new Error(`${key} must be a public https address.`); }
        if (!sources.some(source => source.replace(/\/$/, '') === url.replace(/\/$/, ''))) throw new Error(`Cite the exact ${key} URL in sources.`);
    }
    const urls = [...new Set([candidate.team_source, candidate.growth_source, String(values.person_source), String(values.contact_source)])];
    const pages = await Promise.all(urls.map(async url => {
        const page = await browserNavigate(url);
        if (!isOfficial(page.url)) throw new Error('Primary evidence redirected outside the prospect website.');
        return { url, text: page.text, whole: page.plainText || page.text };
    }));
    for (const [label, url, quote] of [['team', candidate.team_source, candidate.team_quote], ['growth', candidate.growth_source, candidate.growth_quote]]) {
        if (!quoteOnPage(pages.find(page => page.url === url)?.whole ?? '', quote)) throw new Error(`The ${label} quote was not found on ${url}. Copy it exactly as the page shows it, or cite the page it is on. Quote given: "${quote.slice(0, 200)}"`);
    }
    return pages.map(page => `Opened primary source: ${page.url}\n${page.text.slice(0, 6500)}`).join('\n\n');
}
