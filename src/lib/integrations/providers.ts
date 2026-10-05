/**
 * Integration providers Nucleas knows how to connect. Capabilities (Phase 2) bind to these;
 * the UI groups them by domain, never by vendor.
 */

export type IntegrationDomain = 'analytics' | 'search' | 'seo' | 'social' | 'email' | 'payments' | 'commerce' | 'ads' | 'finance' | 'product' | 'hosting' | 'code';
export type IntegrationAuthKind = 'api_key' | 'oauth' | 'github_app' | 'webhook';
/** org = one account shared by every company (e.g. our Ahrefs subscription); company = one per company. */
export type IntegrationScope = 'org' | 'company';

export interface IntegrationProviderDefinition {
  id: string;
  name: string;
  domain: IntegrationDomain;
  authKind: IntegrationAuthKind;
  defaultScope: IntegrationScope;
  /** Tech/marketing stack catalog ids that imply this provider is in use. */
  stackToolIds: string[];
  /** Guidance shown when connecting. */
  credentialHint?: string;
}

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  { id: 'ga4', name: 'Google Analytics', domain: 'analytics', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['googleanalytics'] },
  { id: 'gsc', name: 'Google Search Console', domain: 'search', authKind: 'oauth', defaultScope: 'company', stackToolIds: [] },
  { id: 'adsense', name: 'Google AdSense', domain: 'ads', authKind: 'oauth', defaultScope: 'company', stackToolIds: [] },
  { id: 'posthog', name: 'PostHog', domain: 'analytics', authKind: 'api_key', defaultScope: 'company', stackToolIds: ['posthog'], credentialHint: 'Personal API key with read access to the project.' },
  { id: 'ahrefs', name: 'Ahrefs', domain: 'seo', authKind: 'api_key', defaultScope: 'org', stackToolIds: [], credentialHint: 'Ahrefs API v3 key (Account settings → API keys). Free plans return limited data.' },
  { id: 'facebook', name: 'Facebook Pages', domain: 'social', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['facebook'], credentialHint: 'Connect the Page identity that will review and eventually publish approved posts.' },
  { id: 'instagram', name: 'Instagram Business', domain: 'social', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['instagram'], credentialHint: 'Connect an Instagram professional account through its linked Meta account.' },
  { id: 'linkedin', name: 'LinkedIn Pages', domain: 'social', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['linkedin'], credentialHint: 'Connect the organization Page that will review and eventually publish approved posts.' },
  { id: 'x', name: 'X', domain: 'social', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['x'], credentialHint: 'Connect the company profile that will review and eventually publish approved posts.' },
  { id: 'bluesky', name: 'Bluesky', domain: 'social', authKind: 'oauth', defaultScope: 'company', stackToolIds: ['bluesky'], credentialHint: 'Connect the company profile that will review and eventually publish approved posts.' },
  { id: 'brevo', name: 'Brevo', domain: 'email', authKind: 'api_key', defaultScope: 'company', stackToolIds: ['brevo'], credentialHint: 'Brevo API v3 key (SMTP & API → API keys).' },
  { id: 'stripe', name: 'Stripe', domain: 'payments', authKind: 'api_key', defaultScope: 'company', stackToolIds: ['stripe'], credentialHint: 'Restricted key with read-only access. Never the secret key used for Nucleas billing.' },
  { id: 'shopify', name: 'Shopify', domain: 'commerce', authKind: 'api_key', defaultScope: 'company', stackToolIds: ['shopify'], credentialHint: 'Custom app Admin API access token with read scopes.' },
  { id: 'mercury', name: 'Mercury', domain: 'finance', authKind: 'api_key', defaultScope: 'company', stackToolIds: [], credentialHint: 'Read-only API token (Settings → API tokens). Never a read-write token.' },
  { id: 'signups', name: 'Signup events', domain: 'product', authKind: 'webhook', defaultScope: 'company', stackToolIds: [], credentialHint: 'Your platform sends a signed event to Nucleas whenever someone signs up (free users).' },
  { id: 'vercel', name: 'Vercel', domain: 'hosting', authKind: 'api_key', defaultScope: 'org', stackToolIds: ['vercel'], credentialHint: 'Vercel access token scoped to the team.' },
  { id: 'github', name: 'GitHub', domain: 'code', authKind: 'github_app', defaultScope: 'org', stackToolIds: [] },
];

const byId = new Map(INTEGRATION_PROVIDERS.map((p) => [p.id, p]));

export function getIntegrationProvider(id: string): IntegrationProviderDefinition | undefined {
  return byId.get(id);
}

/** Providers every owned company is confirmed to use (Ryan, 2026-09-27). */
export const OWNED_COMPANY_BASELINE_PROVIDERS = ['ga4', 'gsc', 'brevo', 'stripe'] as const;

/** Maps recorded stack tool ids to provider ids; returns unmapped ids separately. */
export function providersFromStacks(toolIds: string[]): { providerIds: string[]; unmapped: string[] } {
  const providerIds = new Set<string>();
  const unmapped: string[] = [];
  for (const toolId of toolIds) {
    const match = INTEGRATION_PROVIDERS.find((p) => p.stackToolIds.includes(toolId));
    if (match) providerIds.add(match.id);
    else unmapped.push(toolId);
  }
  return { providerIds: [...providerIds], unmapped };
}
