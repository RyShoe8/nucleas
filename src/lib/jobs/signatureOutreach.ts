import { put } from '@vercel/blob';
import { browserNavigate, browserWorkerCall } from '@/lib/ai/tools/browserClient';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

export async function captureOutreach(values: Record<string, unknown>, sources: string[], path: string) {
  const read = (key: string) => String(values[key] ?? '').trim();
  const website = assertSafePublicHttpsUrl(read('website'));
  const person = assertSafePublicHttpsUrl(read('person_source'));
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');
  if (host(website) !== host(person) || !sources.some(s => s.replace(/\/$/, '') === person.href.replace(/\/$/, ''))) throw new Error('The person needs a cited official team page.');
  const contact = assertSafePublicHttpsUrl(read('contact_source'));
  if (host(contact) !== host(website) || !sources.some(s => s.replace(/\/$/, '') === contact.href.replace(/\/$/, ''))) throw new Error('Cite the official contact page.');
  const pages = new Map<string, ReturnType<typeof browserNavigate>>();
  const open = (url: string) => {
    if (!pages.has(url)) pages.set(url, browserNavigate(url));
    return pages.get(url)!;
  };
  const [contactPage, homepage, teamPage] = await Promise.all([open(contact.href), open(website.href), open(person.href)]);
  const teamText = teamPage.text.toLowerCase();
  if (host(new URL(teamPage.url)) !== host(website) || ![read('first_name'), read('last_name'), read('role')].every(v => v && teamText.includes(v.toLowerCase()))) throw new Error('The name and role must be visible on the official team page.');
  const feed = read('feed');
  if (feed && host(assertSafePublicHttpsUrl(feed)) !== host(website) && !homepage.links.includes(feed)) throw new Error('Choose a first-party feed or one linked from the official site.');
  if (host(new URL(contactPage.url)) !== host(website) || !contactPage.text.toLowerCase().includes(read('email').toLowerCase())) throw new Error('Work email must be publicly listed on the contact page.');
  const destination = assertSafePublicHttpsUrl(read('cta_url'));
  if (!sources.some(s => s.replace(/\/$/, '') === destination.href.replace(/\/$/, ''))) throw new Error('Cite the working destination for the secondary CTA.');
  const social = assertSafePublicHttpsUrl(read('social'));
  if (!homepage.links.some(link => link.replace(/\/$/, '').toLowerCase() === social.href.replace(/\/$/, '').toLowerCase())) throw new Error('The official homepage must link to this social profile.');
  const handle = social.hostname === 'bsky.app' ? social.pathname.match(/^\/profile\/([\w.-]+)\/?$/)?.[1] : undefined;
  const mentions = read('post').match(/@[a-z0-9_.-]+/gi) ?? [];
  if (!handle || !mentions.some(m => m.replace(/[.]$/, '').toLowerCase() === '@' + handle.toLowerCase())) throw new Error('The post must tag the verified company profile.');
  if (Array.from(read('post')).length > 300) throw new Error('Bluesky post exceeds 300 characters.');
  const concept = Object.fromEntries(['company','website','first_name','last_name','role','email','feed','logo','primary_color','secondary_color','social','preset','cta_type','cta_label','cta_url'].map(key => [key, read(key)]));
  const { jpeg, headline } = await browserWorkerCall<{ jpeg: string; headline: string }>('/signature/capture', concept, { timeoutMs: 55000 });
  values.latest_article = headline;
  const bytes = Buffer.from(jpeg, 'base64');
  if (bytes.length > 2_000_000 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('The worker did not return a signature screenshot.');
  return (await put(path, bytes, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true })).url;
}
