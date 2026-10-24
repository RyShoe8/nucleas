/** Client-safe contract. No credentials or installation IDs are exposed. */
export type RoundupStatus = 'queued' | 'generating' | 'draft' | 'failed' | 'publishing' | 'publish_uncertain' | 'published' | 'rejected';
export interface RoundupDraft {
  id: string;
  companyId: string;
  status: RoundupStatus;
  progress: string;
  error: string | null;
  title: string;
  summary: string;
  bodyMarkdown: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  coveredIds: string[];
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
  details: { sources: { id: string; title: string; url: string; description: string }[]; logs: { stage: string; message: string; at: string }[]; warnings?: string[] };
}
export interface RoundupActivity {
  id: string; companyId: string; kind: 'release_roundup'; title: string;
  status: RoundupStatus; progress: string; error: string | null;
  createdAt: string; updatedAt: string;
}
export interface RoundupResponse {
  settings: { companyId: string; repoIds: string[]; availableRepos: { id: string; name: string }[]; sourceEndpoint: string | null; configured: boolean; coverageEnd: string | null };
  drafts: RoundupDraft[];
  history: RoundupDraft[];
  activities: RoundupActivity[];
  setupRequirements: { code: string; message: string }[];
  permissions: { canDraft: boolean; canManage: boolean; canPublish: boolean };
}
export type RoundupAction =
  | { companyId: string; action: 'configure'; repoIds: string[] }
  | { companyId: string; action: 'generate' | 'reopen' }
  | { companyId: string; action: 'save'; id: string; title: string; summary: string; bodyMarkdown: string }
  | { companyId: string; action: 'reject' | 'publish'; id: string };
/** POST returns {draft}, or {settings} for configure; failures return {error}. */
export interface RoundupMutationResponse { draft?: RoundupDraft; settings?: RoundupResponse['settings'] }

/** Site wire contract: GET must supply the last manually published blog on first use. */
export interface RoundupSiteResponse {
  games: { id: string; slug: string; title: string; url: string; publishedAt: string; description?: string; platform?: string | string[]; platforms?: string | string[]; free?: boolean; isFree?: boolean; gameplay?: string | string[] }[];
  baseline?: { publishedAt: string | null; coverageEnd?: string | null; coveredIds?: string[]; slug: string; url?: string } | null;
  lastRoundup?: { publishedAt: string | null; coverageEnd?: string | null; coveredIds?: string[]; slug: string; url?: string } | null;
  limitations?: string[];
}
