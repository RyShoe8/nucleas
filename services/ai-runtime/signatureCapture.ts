import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { assertSafePublicHttpsUrl, isSafePublicHost } from '../../src/lib/ai/tools/ssrf';

// Chromium receives only image bytes fetched over pinned public IPv4 connections.
async function assetBytes(raw: string, feed = false) {
  const url = assertSafePublicHttpsUrl(raw);
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(a => !isSafePublicHost(a.address))) throw new Error('Unsafe image host');
  return new Promise<{ body: Buffer; contentType: string }>((resolve, reject) => {
    const req = get(url, { family: 4, agent: false, lookup: (_host, _opts, cb) => cb(null, addresses[0].address, 4) }, res => {
      const contentType = String(res.headers['content-type'] ?? '').split(';')[0];
      if (res.statusCode !== 200 || !feed && !/^image\/(png|webp|jpeg|gif|svg\+xml)$/.test(contentType)) {
        res.destroy(); reject(new Error('Unsupported image')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (feed ? 600_000 : 3_000_000)) req.destroy(new Error('Image exceeds 3 MB'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType }));
    });
    const timeout = setTimeout(() => req.destroy(new Error('Image timed out')), 8000);
    req.on('close', () => clearTimeout(timeout));
    req.on('error', reject);
  });
}

export async function captureSignature(concept: Record<string, unknown>) {
  const feed = concept.feed ? await assetBytes(String(concept.feed), true) : null;
  const { chromium } = await import('playwright' as string);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor: 2, javaScriptEnabled: false, serviceWorkers: 'block' });
    const logo = await assetBytes(String(concept.logo));
    await page.setContent('<img alt="" src="data:' + logo.contentType + ';base64,' + logo.body.toString('base64') + '">');
    const dimensions = await page.locator('img').evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }));
    if (dimensions.width < 120 || dimensions.height < 24) throw new Error('Use a higher-resolution official logo.');
    const logoHeightPx = Math.round(110 * dimensions.height / dimensions.width);
    if (logoHeightPx < 24 || logoHeightPx > 240) throw new Error('Choose a logo variant suited to an email signature.');
    const response = await fetch('https://tailnote.io/api/signature-concept', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...concept, logoHeightPx, feedXml: feed?.body.toString('utf8') ?? '' }), signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error('Tailnote could not render this signature');
    const { html, promoPng, headline } = await response.json();
    if (typeof html !== 'string' || html.length > 200000) throw new Error('Invalid Tailnote preview');
    await page.route('**/*', async (route: {request(): {url(): string; resourceType(): string}; abort(): Promise<void>; fulfill(opts: {body: Buffer; contentType: string}): Promise<void>}) => {
      const req = route.request();
      if (req.url() === 'https://tailnote.io/preview-assets/latest-blog.png' && typeof promoPng === 'string') {
        return route.fulfill({ body: Buffer.from(promoPng, 'base64'), contentType: 'image/png' });
      }
      if (req.resourceType() !== 'image' || (req.url() !== concept.logo && !req.url().startsWith('https://tailnote.io/'))) return route.abort();
      try { await route.fulfill(req.url() === concept.logo ? logo : await assetBytes(req.url())); } catch { await route.abort(); }
    });
    await page.setContent('<main style="background:white;padding:36px;width:max-content;max-width:760px">' + html + '</main>', { timeout: 16000 });
    const images = await page.locator('main img').evaluateAll((nodes: HTMLImageElement[]) => nodes.map(n => ({ src: n.src, width: n.naturalWidth, height: n.naturalHeight })));
    if (!images.some((img: {src: string; width: number; height: number}) => img.src === concept.logo && img.width >= 120 && img.height >= 24)) throw new Error('A higher-resolution official logo is required');
    if ((feed && (!headline || !images.some((img: {src: string; width: number}) => img.src.endsWith('/preview-assets/latest-blog.png') && img.width >= 300))) || images.some((img: {width: number}) => !img.width)) throw new Error('The finished signature must show its latest blog promo and every image.');
    const card = page.locator('main');
    const fits = await card.evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return box.width >= 250 && box.width <= 840 && box.height <= 1000 && el.scrollWidth <= el.clientWidth + 1;
    });
    if (!fits) throw new Error('Signature overflows its social preview. Try a shorter CTA or a more compact layout.');
    const visibleText = (await card.innerText()).toLowerCase();
    for (const value of [concept.first_name, concept.last_name, concept.role, concept.email, concept.cta_label]) {
      if (typeof value !== 'string' || !visibleText.includes(value.toLowerCase())) throw new Error('Signature is missing the name or CTA');
    }
    return { headline, jpeg: (await card.screenshot({ type: 'jpeg', quality: 90 })).toString('base64') };
  } finally { await browser.close(); }
}
