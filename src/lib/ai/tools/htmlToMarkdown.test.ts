import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './htmlToMarkdown';

const filler = 'Real article content that is long enough to count as the main body of the page. '.repeat(4);

describe('htmlToMarkdown', () => {
  it('keeps headings, lists and links and drops scripts and navigation', () => {
    const md = htmlToMarkdown(
      `<html><body><nav><a href="/x">Menu</a></nav><script>alert(1)</script>
       <h1>Pricing</h1><p>${filler}</p><ul><li>Starter</li><li>Pro</li></ul>
       <p>See <a href="/docs">the docs</a>.</p><footer>Copyright</footer></body></html>`,
      { baseUrl: 'https://example.org/page' }
    );
    expect(md).toContain('# Pricing');
    expect(md).toContain('- Starter');
    expect(md).toContain('[the docs](https://example.org/docs)');
    expect(md).not.toContain('alert(1)');
    expect(md).not.toContain('Menu');
    expect(md).not.toContain('Copyright');
  });

  it('prefers the main element when the page has one', () => {
    const md = htmlToMarkdown(`<body><div>Sidebar noise</div><main><h2>Docs</h2><p>${filler}</p></main></body>`);
    expect(md).toContain('## Docs');
    expect(md).not.toContain('Sidebar noise');
  });

  it('neutralises javascript: links and inline data images', () => {
    const md = htmlToMarkdown(
      `<body><p>${filler}</p><a href="javascript:alert(1)">bad</a><img src="data:image/png;base64,AAAA" alt="x"></body>`,
      { baseUrl: 'https://example.org/' }
    );
    expect(md).not.toContain('javascript:');
    expect(md).not.toContain('data:image');
  });

  it('caps output length', () => {
    expect(htmlToMarkdown(`<body><p>${'a'.repeat(5000)}</p></body>`, { maxChars: 100 }).length).toBe(100);
  });
});
