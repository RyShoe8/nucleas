import TurndownService from 'turndown';

const NOISE_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'template', 'nav', 'footer', 'aside', 'form', 'button', 'select', 'dialog'];

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', linkStyle: 'inlined' });
  service.remove(NOISE_TAGS as TurndownService.Filter);
  // Inline data: images are large and useless as text.
  service.addRule('dropDataImages', {
    filter: (node) => node.nodeName === 'IMG' && /^data:/i.test(node.getAttribute('src') ?? ''),
    replacement: () => '',
  });
  return service;
}

/** The page's main content when it declares one, otherwise the whole document. */
function mainContent(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  for (const tag of ['main', 'article']) {
    const match = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, 'i'));
    if (match && match[1].replace(/<[^>]+>/g, '').trim().length > 200) return match[1];
  }
  return body;
}

/** Page HTML to compact markdown. Strips scripts, navigation and other chrome; keeps headings, lists, tables-as-text and links. */
export function htmlToMarkdown(html: string, options: { baseUrl?: string; maxChars?: number } = {}): string {
  const source = mainContent(html.replace(/<!--[\s\S]*?-->/g, ''));
  let markdown = turndown().turndown(source);
  if (options.baseUrl) {
    markdown = markdown.replace(/\]\(([^)\s]+)\)/g, (whole, href: string) => {
      try {
        const abs = new URL(href, options.baseUrl);
        return abs.protocol === 'https:' || abs.protocol === 'http:' ? `](${abs.toString()})` : '](#)';
      } catch {
        return whole;
      }
    });
  }
  markdown = markdown.replace(/^(\s*)-\s{3}/gm, '$1- ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return options.maxChars ? markdown.slice(0, options.maxChars) : markdown;
}
