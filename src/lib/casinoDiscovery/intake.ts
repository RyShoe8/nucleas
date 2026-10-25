import 'server-only';
import { Types } from 'mongoose';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { browserObserve } from '@/lib/ai/tools/browserClient';
import { z } from 'zod';

const inventorySchema = z.object({ casinos: z.array(z.object({ name: z.string(), slug: z.string(), status: z.string(), website_url: z.string().nullish(), login_url: z.string().nullish() })) }).passthrough();
type IntakeResponse = { csrf_token?: string; casinos?: {name:string;slug:string;website_url?:string;login_url?:string;status:string}[]; imports?:{request_id:string;social_states:Record<string,string>;social_errors:Record<string,string>}[]; url?: string; social_states?: Record<string,string>; existing?: boolean };

/** Uses only the captured first-party admin origin. Never follows a redirect carrying cookies. */
export async function casinoIntake(organizationId: Types.ObjectId, companyId: Types.ObjectId) {
 const session = await adminSessionFor(organizationId, String(companyId));
 if (!session) throw new Error('Reconnect the company admin account before discovering or adding sites.');
 const origin = new URL(assertSafePublicHttpsUrl(session.baseUrl)).origin;
 const jar = new Map(session.cookies.filter(cookie => { const domain = cookie.domain.replace(/^\./,''); return new URL(origin).hostname === domain || new URL(origin).hostname.endsWith(`.${domain}`); }).map(cookie => [cookie.name,cookie.value]));
 const call = async (method: 'GET'|'POST', body?: unknown, csrf?: string): Promise<IntakeResponse> => {
  const response = await fetch(`${origin}/admin/intake/casinos`, { method, redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { accept: 'application/json', cookie: [...jar].map(([key,value])=>`${key}=${value}`).join('; '), ...(body ? {'content-type':'application/json', 'x-csrf-token':csrf!, origin} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
  const data = await response.json().catch(()=>({}));
  if (!response.ok && method === 'GET' && [401,403,419,302].includes(response.status)) {
   // The session check uses this same browser transport. Direct cloud requests can be blocked
   // even while the captured browser session is authenticated. This fallback can only read.
   const target = `${origin}/admin/intake/casinos`;
   const seen = await browserObserve({ ...session, url: target, maxChars: 40000 });
   if (!seen.loggedIn) throw new Error('The browser reached a signed-out page while reading the casino inventory. Check the admin session.');
   if (new URL(seen.url).origin !== origin || new URL(seen.url).pathname !== '/admin/intake/casinos') throw new Error('The browser did not reach the casino inventory endpoint. The admin login may still be valid.');
   let inventory: unknown;
   try { inventory = JSON.parse(seen.text.replace(/^Pretty-print\s*/, '')); } catch { throw new Error('The browser did not return a complete JSON casino inventory. Discovery stopped rather than guessing existing sites.'); }
   const checked = inventorySchema.safeParse(inventory);
   if (!checked.success) throw new Error('The browser response was not a valid casino inventory. Discovery stopped rather than treating the catalog as empty.');
   return checked.data as IntakeResponse;
  }
  if (!response.ok) throw new Error([401,403,419,302].includes(response.status) ? `Site intake rejected the ${method} request (HTTP ${response.status}). This does not establish that the browser login expired; check endpoint access and session permissions.` : data.message ?? `Site intake returned HTTP ${response.status}.`);
  return data as { csrf_token?: string; casinos?: {name:string;slug:string;website_url?:string;login_url?:string;status:string}[]; imports?:{request_id:string;social_states:Record<string,string>;social_errors:Record<string,string>}[]; url?: string; social_states?: Record<string,string>; existing?: boolean };
 };
 return { origin, inventory: () => call('GET'), add: async (body: unknown) => { const state = await call('GET'); if(!state.csrf_token) throw new Error('Site intake did not provide its CSRF token.'); return call('POST', body, state.csrf_token); } };
}
