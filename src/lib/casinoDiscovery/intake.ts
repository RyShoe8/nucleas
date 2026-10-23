import 'server-only';
import { Types } from 'mongoose';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

/** Uses only the captured first-party admin origin. Never follows a redirect carrying cookies. */
export async function casinoIntake(organizationId: Types.ObjectId, companyId: Types.ObjectId) {
 const session = await adminSessionFor(organizationId, String(companyId));
 if (!session) throw new Error('Reconnect the company admin account before discovering or adding sites.');
 const origin = new URL(assertSafePublicHttpsUrl(session.baseUrl)).origin;
 const jar = new Map(session.cookies.filter(cookie => { const domain = cookie.domain.replace(/^\./,''); return new URL(origin).hostname === domain || new URL(origin).hostname.endsWith(`.${domain}`); }).map(cookie => [cookie.name,cookie.value]));
 const call = async (method: 'GET'|'POST', body?: unknown, csrf?: string) => {
  const response = await fetch(`${origin}/admin/intake/casinos`, { method, redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { accept: 'application/json', cookie: [...jar].map(([key,value])=>`${key}=${value}`).join('; '), ...(body ? {'content-type':'application/json', 'x-csrf-token':csrf!, origin} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error([401,403,419,302].includes(response.status) ? 'The site admin session expired or lacks permission. Reconnect it.' : data.message ?? `Site intake returned HTTP ${response.status}.`);
  return data as { csrf_token?: string; casinos?: {name:string;slug:string;website_url?:string;login_url?:string;status:string}[]; imports?:{request_id:string;social_states:Record<string,string>;social_errors:Record<string,string>}[]; url?: string; social_states?: Record<string,string>; existing?: boolean };
 };
 return { origin, inventory: () => call('GET'), add: async (body: unknown) => { const state = await call('GET'); if(!state.csrf_token) throw new Error('Site intake did not provide its CSRF token.'); return call('POST', body, state.csrf_token); } };
}
