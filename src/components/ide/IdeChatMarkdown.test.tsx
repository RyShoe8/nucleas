import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IdeChatMarkdown, { stripMarkdownImages } from '@/components/ide/IdeChatMarkdown';

describe('stripMarkdownImages', () => {
  it('removes image markdown so captions are not paired with broken icons', () => {
    expect(
      stripMarkdownImages('See this:\n\n![Gameplay](https://cdn.example.com/a.png)\n\nMore text')
    ).toBe('See this:\n\nMore text');
  });
});

describe('IdeChatMarkdown', () => {
  it('draws tables with borders and room to scroll, and keeps their links clickable', () => {
    const html = renderToStaticMarkup(<IdeChatMarkdown text={'| Site | Review |\n|---|---|\n| IGN | [Ruiner](https://ign.com/a) |'} />);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('<th class=');
    expect(html).toContain('<td class=');
    expect(html).toContain('href="https://ign.com/a"');
  });

  it('renders bold and clickable links without raw markdown markers', () => {
    const html = renderToStaticMarkup(
      <IdeChatMarkdown text={'See **Castlevania ReVamped** at [InvertedDungeon](https://www.inverteddungeon.com/page).'} />
    );
    expect(html).not.toContain('**');
    expect(html).toContain('<strong');
    expect(html).toContain('href="https://www.inverteddungeon.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('InvertedDungeon');
  });

  it('does not render inline markdown images', () => {
    const html = renderToStaticMarkup(
      <IdeChatMarkdown text={'Caption\n\n![shot](https://cdn.example.com/x.png)\n\nDone'} />
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('Caption');
    expect(html).toContain('Done');
  });
});
