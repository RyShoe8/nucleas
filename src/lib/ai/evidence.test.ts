import { describe, expect, it } from 'vitest';
import { addImage, addSource, emptyEvidence, finishEvidence, linksInText, mergeEvidence } from './evidence';

describe('keeping what an answer is based on', () => {
  it('finds links, with their labels and without trailing punctuation', () => {
    expect(linksInText('See [IGN](https://www.ign.com/a) and https://pcgamer.com/b.')).toEqual([
      { url: 'https://www.ign.com/a', title: 'IGN' },
      { url: 'https://pcgamer.com/b' },
    ]);
  });

  it('lists pages the answer links to first, and marks them', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://read-but-not-used.com/', title: 'Other', snippet: 'A page' });
    addSource(evidence, { url: 'https://www.ign.com/review/', title: 'IGN review', snippet: 'A review' });
    const finished = finishEvidence(evidence, 'I found [this review](https://www.ign.com/review).');
    expect(finished?.sources.map((source) => [source.title, source.cited])).toEqual([['IGN review', true], ['Other', undefined]]);
  });

  it('adds a link only the answer mentions', () => {
    expect(finishEvidence(emptyEvidence(), 'See [PC Gamer](https://pcgamer.com/).')?.sources).toEqual([{ url: 'https://pcgamer.com/', title: 'PC Gamer', cited: true }]);
  });

  it('fills in a page\'s details when it turns up again, and does not repeat it', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://site.com/a/' });
    addSource(evidence, { url: 'https://site.com/a', title: 'A page', snippet: 'Details' });
    expect(evidence.sources).toEqual([{ url: 'https://site.com/a/', title: 'A page', snippet: 'Details' }]);
  });

  it.each(['javascript:alert(1)', 'http://site.com/', 'https://localhost/x', 'https://127.0.0.1/x', 'not a url', ''])('refuses an unsafe address: %s', (url) => {
    const evidence = emptyEvidence();
    addSource(evidence, { url, title: 'x' });
    addImage(evidence, { imageUrl: url, title: 'x' });
    expect(evidence).toEqual(emptyEvidence());
  });

  it('keeps the page an image came from only when it is safe', () => {
    const evidence = emptyEvidence();
    addImage(evidence, { imageUrl: 'https://cdn.com/a.png', title: 'A', pageUrl: 'https://site.com/' });
    addImage(evidence, { imageUrl: 'https://cdn.com/b.png', pageUrl: 'javascript:alert(1)' });
    addImage(evidence, { imageUrl: 'https://cdn.com/a.png', title: 'Again' });
    expect(evidence.images).toEqual([{ imageUrl: 'https://cdn.com/a.png', title: 'A', pageUrl: 'https://site.com/' }, { imageUrl: 'https://cdn.com/b.png', title: 'Image' }]);
  });

  it('caps what is stored', () => {
    const evidence = emptyEvidence();
    for (let index = 0; index < 60; index++) {
      addSource(evidence, { url: `https://site.com/${index}`, snippet: 'x'.repeat(1000) });
      addImage(evidence, { imageUrl: `https://site.com/${index}.png` });
    }
    mergeEvidence(evidence, { data: Array.from({ length: 30 }, () => ({ label: 'x'.repeat(500), detail: 'y'.repeat(5000) })) });
    const finished = finishEvidence(evidence, '')!;
    expect(finished.sources).toHaveLength(30);
    expect(finished.sources[0]!.snippet!.length).toBeLessThanOrEqual(240);
    expect(finished.images).toHaveLength(18);
    expect(finished.data).toHaveLength(12);
    expect(finished.data[0]!.detail.length).toBe(1500);
  });

  it('has nothing to show for an answer with no evidence', () => {
    expect(finishEvidence(emptyEvidence(), 'Hello there.')).toBeUndefined();
  });
});
