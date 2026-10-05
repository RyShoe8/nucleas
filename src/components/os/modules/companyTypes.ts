/** Client-side shapes returned by /api/os/companies. */

export interface OsCompanySummary {
    id: string;
    name: string;
    relationship: 'client' | 'owned' | 'internal';
    domain?: string;
    devUrl?: string;
    color?: string;
    logo?: string;
    connections: Record<string, number>;
}

export interface OsConnection {
    id: string;
    provider: string;
    providerName: string;
    domain: string;
    scope: 'org' | 'company';
    companyId: string | null;
    status: string;
    credentialHint?: string;
    accountLabel?: string;
    planLabel?: string;
    planLimited: boolean;
    lastVerifiedAt?: string;
    lastError?: string;
    connectable: boolean;
    signIn: 'google' | null;
    webhook: boolean;
    keyGuidance?: string;
}

export interface OsCompanyDetail {
    canManage: boolean;
    company: OsCompanySummary & {
        description?: string;
        liveUrl?: string;
        urls: string[];
        hubProjectId?: string;
        profileSource: 'hub_project' | 'client';
    };
    projects: { id: string; name: string; status: string; isHub: boolean; openTasks: number; totalTasks: number }[];
    connections: OsConnection[];
    stats: { aiCitations: number; aiCitationSeries: { date: string; value: number }[] };
}

export const RELATIONSHIP_LABEL: Record<OsCompanySummary['relationship'], string> = {
    owned: 'Our business',
    internal: 'Operating company',
    client: 'Client',
};

export const DOMAIN_LABEL: Record<string, string> = {
    analytics: 'Analytics',
    search: 'Search',
    seo: 'SEO',
    social: 'Social',
    email: 'Email',
    payments: 'Payments',
    commerce: 'Commerce',
    ads: 'Advertising',
    finance: 'Finance',
    product: 'Product',
    hosting: 'Hosting',
    code: 'Code',
};
