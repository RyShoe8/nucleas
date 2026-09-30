export type Bucket = 'important' | 'normal' | 'updates' | 'promotions' | 'suspicious';
export type View = 'inbox' | 'unread' | 'starred' | 'sent' | 'all' | 'updates' | 'promotions' | 'suspicious';

export interface MailAddress { name: string; email: string }

export interface Account {
    id: string;
    emailAddress: string;
    label: string;
    color: string;
    companyId: string | null;
    companyName: string | null;
    unread: number;
    lastSyncAt: string | null;
    lastSyncOk: boolean | null;
    lastSyncError: string | null;
    needsReauth: boolean;
}

export interface Counts { inbox: number; updates: number; promotions: number; suspicious: number }

export interface Triage { bucket: Bucket; reasons: string[]; risk: number }

export interface ThreadSummary {
    id: string;
    accountId: string;
    threadId: string;
    subject: string;
    snippet: string;
    from: MailAddress;
    date: string;
    unread: boolean;
    starred: boolean;
    count: number;
    hasAttachments: boolean;
    aiSummary: string | null;
    triage: Triage | null;
}

export interface ThreadMessage {
    id: string;
    from: MailAddress;
    to: MailAddress[];
    cc: MailAddress[];
    date: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    unread: boolean;
    sent: boolean;
    attachments: { filename: string; mimeType: string; size: number; attachmentId: string; inline: boolean }[];
    aiSummary: string | null;
    triage: Triage | null;
}

export const ACCOUNT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export const accountColor = (account: Pick<Account, 'color' | 'id'>, all: Account[]): string =>
    account.color || ACCOUNT_COLORS[Math.max(0, all.findIndex((a) => a.id === account.id)) % ACCOUNT_COLORS.length];

export const displayName = (a: MailAddress) => a.name || a.email || 'Unknown';

export function shortDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
}

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
        const res = await fetch(url, { cache: 'no-store', ...init });
        const data = (await res.json().catch(() => ({}))) as T & { error?: string };
        return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Failed (${res.status})` };
    } catch {
        return { ok: false, error: 'Could not reach Nucleas.' };
    }
}

export const post = <T,>(url: string, body: unknown) => api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
