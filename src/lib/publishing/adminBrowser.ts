import 'server-only';
import { browserObserve, browserWorkerCall } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';
import type { AdminBrowser } from './admin';

/** The browser worker on the VPS, opening the company's admin with its captured session. */
export const workerAdminBrowser: AdminBrowser = {
  inspect: (session, url) => browserWorkerCall('/admin/inspect', { baseUrl: session.baseUrl, url, cookies: session.cookies }, { timeoutMs: 60_000 }),
  fill: (session, input) => browserWorkerCall('/admin/fill', { baseUrl: session.baseUrl, cookies: session.cookies, ...input }, { timeoutMs: 90_000 }),
  read: async (session, url) => {
    const seen = await browserObserve({ baseUrl: session.baseUrl, url, cookies: session.cookies }, { timeoutMs: 60_000 });
    return { loggedIn: seen.loggedIn, text: seen.text };
  },
};

export function adminBrowserReady(): boolean {
  return isBrowserWorkerConfigured();
}
