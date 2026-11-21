import type { ParsedIntent } from './IntentParser';
import type { WorkspaceIntentContextPayload } from './workspaceIntentContext';

export type OsVoiceScope = { moduleId?: string; companyId?: string; companyName?: string; section?: string };
const companyDestinations = new Set(['company', 'work', 'assistant', 'attention', 'marketing', 'growth', 'content', 'brand-voice', 'building', 'mail']);
const destinations: Record<string, { moduleId: string; section?: string; tool?: string; create?: string }> = {
    office: { moduleId: 'office' }, home: { moduleId: 'office' }, companies: { moduleId: 'companies' },
    work: { moduleId: 'work' }, jobs: { moduleId: 'work' }, responsibilities: { moduleId: 'work' },
    inbox: { moduleId: 'attention' }, notifications: { moduleId: 'attention' }, approvals: { moduleId: 'attention' },
    tools: { moduleId: 'tools' }, screenshot: { moduleId: 'tools', tool: 'screenshot' },
    'screen recorder': { moduleId: 'tools', tool: 'recording' }, 'recent captures': { moduleId: 'tools', tool: 'recent' },
    ask: { moduleId: 'assistant' }, 'ask nucleas': { moduleId: 'assistant' }, settings: { moduleId: 'settings' },
    overview: { moduleId: 'company', section: 'overview' }, analytics: { moduleId: 'company', section: 'overview' },
    revenue: { moduleId: 'company', section: 'overview' }, performance: { moduleId: 'company', section: 'overview' },
    people: { moduleId: 'company', section: 'people' }, team: { moduleId: 'company', section: 'people' },
    library: { moduleId: 'company', section: 'library' }, connections: { moduleId: 'company', section: 'connections' },
    integrations: { moduleId: 'company', section: 'connections' },
    marketing: { moduleId: 'marketing' }, growth: { moduleId: 'growth' }, content: { moduleId: 'content' },
    'brand voice': { moduleId: 'brand-voice' }, building: { moduleId: 'building' }, code: { moduleId: 'building' },
    mail: { moduleId: 'mail' }, 'animation studio': { moduleId: 'animation' },
    'ai budgets': { moduleId: 'ai-budgets' }, 'ai spend': { moduleId: 'ai-spend' }, 'ai engine': { moduleId: 'ai-routing' },
    'give work': { moduleId: 'work', create: '1' },
};

/** Small navigation commands are deterministic. Everything substantive uses the existing Ask engine. */
export function parseOsVoiceIntent(text: string, context?: WorkspaceIntentContextPayload | null): ParsedIntent {
    const raw = text.trim();
    const clean = raw.replace(/^please\s+/i, '').replace(/[.!?]+$/, '').trim();
    const scope = context?.os;
    const slots: Record<string, string> = { ...(scope?.companyId ? { companyId: scope.companyId, companyName: scope.companyName ?? '' } : {}) };
    const navigate = (target: typeof destinations[string], companyQuery?: string): ParsedIntent => ({
        type: 'OS_NAVIGATE', confidence: 1, rawTranscript: raw,
        slots: { ...(companyDestinations.has(target.moduleId) ? slots : {}), ...target, ...(companyQuery && companyDestinations.has(target.moduleId) ? { companyQuery } : {}) },
    });
    if (/^(?:give work|new work|create (?:a |an )?(?:responsibility|work agreement))$/i.test(clean)) return navigate({ moduleId: 'work', create: '1' });
    const nav = /^(?:open|show(?: me)?|go to|navigate to|switch to)\s+(?:the\s+)?(.+)$/i.exec(clean);
    if (nav) {
        let target = nav[1];
        const period = /\s+(?:for |over )?(?:the )?last (7|14|28|90) days$/i.exec(target);
        if (period) { slots.period = period[1]; target = target.slice(0, period.index); }
        if (/^(?:all (?:work|jobs|responsibilities)|all companies)$/i.test(target)) {
            delete slots.companyId; delete slots.companyName;
            return navigate({ moduleId: /companies$/i.test(target) ? 'companies' : 'work' });
        }
        const direct = destinations[target.toLowerCase()];
        if (direct) return navigate(direct);
        const suffix = /^(.+?)\s+(?:for|of|at)\s+(.+)$/i.exec(target);
        if (suffix && destinations[suffix[1].toLowerCase()]) return navigate(destinations[suffix[1].toLowerCase()], suffix[2]);
        const possessive = /^(.+?)(?:['’]s)\s+(.+)$/i.exec(target);
        if (possessive && destinations[possessive[2].toLowerCase()]) return navigate(destinations[possessive[2].toLowerCase()], possessive[1]);
        const company = /^company\s+(.+)$/i.exec(target);
        if (company) return navigate({ moduleId: 'company', section: 'overview' }, company[1]);
        // "Open Tailnote" is a company lookup, never a guessed provider URL.
        if (/^open\s/i.test(clean) && target.length <= 100 && !/\b(?:and|then|send|publish|delete|refund)\b/i.test(target)) return navigate({ moduleId: 'company', section: 'overview' }, target);
    }
    return { type: 'ASK_NUCLEAS', confidence: 1, rawTranscript: raw, slots: { ...slots, text: raw } };
}

type Company = { id: string; name: string; domain?: string | null };
function key(s: string) { return s.toLocaleLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\s\p{P}]+/gu, ''); }
export function matchingVoiceCompanies(query: string, companies: Company[]) {
    const normalized = key(query);
    const exact = companies.filter(c => [c.name, c.domain ?? '', c.name.replace(/\.(com|club|io|app)$/i, '')].some(n => key(n) === normalized));
    return exact;
}

export async function executeOsVoiceIntent(intent: ParsedIntent, deps: {
    companies: () => Promise<Company[]>;
    open: (moduleId: string, payload?: Record<string, string>) => void;
    ask: (text: string, company?: Company) => void;
}) {
    if (!['OS_NAVIGATE', 'ASK_NUCLEAS'].includes(intent.type)) return { success: false, message: 'Try opening a workspace, or ask Nucleas to help with that request.' };
    const s = intent.slots;
    const companyScoped = companyDestinations.has(s.moduleId);
    let company: Company | undefined;
    if ((companyScoped || intent.type === 'ASK_NUCLEAS') && (s.companyQuery || s.companyId)) {
        const companies = await deps.companies();
        const matches = s.companyQuery ? matchingVoiceCompanies(s.companyQuery, companies) : companies.filter(c => c.id === s.companyId);
        if (matches.length !== 1) return { success: false, message: matches.length > 1 ? 'More than one company matches. Use the full company name.' : 'That company is unavailable. Choose a company you have access to and try again.' };
        company = matches[0];
    }
    if (intent.type === 'ASK_NUCLEAS') {
        deps.ask(s.text || intent.rawTranscript, company);
        return { success: true, message: 'Sent to Ask Nucleas. Work and changes follow the usual review process.' };
    }
    const moduleId = s.moduleId;
    if (!Object.values(destinations).some(d => d.moduleId === moduleId)) return { success: false, message: 'That workspace is unavailable.' };
    if (moduleId === 'company' && !company) { deps.open('companies'); return { success: true, message: 'Choose a company to open its workspace.' }; }
    deps.open(moduleId, {
        ...(companyScoped && company ? { companyId: company.id, companyName: company.name } : {}),
        ...(moduleId === 'company' && ['overview', 'work', 'people', 'library', 'connections'].includes(s.section) ? { section: s.section } : {}),
        ...(moduleId === 'company' && ['7', '14', '28', '90'].includes(s.period) ? { period: s.period } : {}),
        ...(moduleId === 'work' && s.create === '1' ? { create: '1' } : {}),
        ...(moduleId === 'tools' && ['screenshot', 'recording', 'recent'].includes(s.tool) ? { tool: s.tool } : {}),
    });
    return { success: true, message: `Opened ${companyScoped && company ? company.name + ' · ' : ''}${s.section || s.tool || moduleId}.` };
}
