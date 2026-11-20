export const DIGEST_MINUTES = [0, 30, 60, 120, 180, 360, 720, 1440] as const;
export type DigestMinutes = typeof DIGEST_MINUTES[number];
export const DIGEST_LABELS: Record<DigestMinutes, string> = { 0: 'Email off', 30: 'Every 30 minutes', 60: 'Every hour', 120: 'Every 2 hours', 180: 'Every 3 hours', 360: 'Every 6 hours', 720: 'Every 12 hours', 1440: 'Every 24 hours' };
export interface AttentionItem { id: string; companyId: string; companyName: string; employeeName: string; title: string; detail: string; since: string; moduleId: string; payload: Record<string, string>; href: string }
export function attentionLink(moduleId: string, payload: Record<string, string>) {
  const url = new URL('/os/desktop', 'https://nucleas.app');
  url.searchParams.set('module', moduleId); url.searchParams.set('payload', JSON.stringify(payload));
  return url.href;
}
