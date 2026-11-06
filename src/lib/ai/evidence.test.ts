import { describe, expect, it } from 'vitest';
import { addImage, addSource, emptyEvidence, finishEvidence, linksInText, mergeEvidence, statementsIn } from './evidence';

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
    expect(finishEvidence(emptyEvidence(), 'See [PC Gamer](https://pcgamer.com/).')?.sources).toEqual([{ url: 'https://pcgamer.com/', title: 'PC Gamer', cited: true, usedFor: ['See PC Gamer.'] }]);
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
    expect(finished.images).toHaveLength(24);
    expect(finished.data).toHaveLength(12);
    expect(finished.data[0]!.detail.length).toBe(1500);
  });

  it('splits text into rows, list items and sentences', () => {
    expect(statementsIn('# Title\nFirst one. Second one.\n- A bullet. Still it.\n| a | b |\n|---|---|\n| c | d |')).toEqual(['First one.', 'Second one.', 'A bullet. Still it.', 'a · b', 'c · d']);
  });

  it('records which facts in the answer came from which page', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://www.ign.com/review', title: 'IGN review', read: true });
    addSource(evidence, { url: 'https://other.com/', title: 'Other', read: true });
    const answer = '| Site | Game |\n|---|---|\n| [IGN](https://www.ign.com/review) | **Ruiner** |\n\nIGN scored it 8. Nothing else is linked. See [IGN](https://www.ign.com/review/) for more.';
    const finished = finishEvidence(evidence, answer, 'Findings\n- Other says [this](https://other.com/) about Ruiner.')!;
    const ign = finished.sources.find((source) => source.url.includes('ign.com'))!;
    expect(ign.usedFor).toEqual(['IGN · Ruiner', 'See IGN for more.']);
    expect(ign.read).toBe(true);
    expect(finished.sources.find((source) => source.url.includes('other.com'))?.found).toEqual(['Other says this about Ruiner.']);
  });

  it('lists used pages first, then pages read, then search results', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://seen.com/', title: 'Seen' });
    addSource(evidence, { url: 'https://read.com/', title: 'Read', read: true });
    expect(finishEvidence(evidence, '[Used](https://used.com/)')?.sources.map((source) => source.title)).toEqual(['Used', 'Read', 'Seen']);
  });

  it('remembers a page was opened even if search found it first', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://site.com/a', title: 'A' });
    addSource(evidence, { url: 'https://site.com/a', read: true });
    expect(evidence.sources[0]?.read).toBe(true);
  });

  it('does not let one page crowd out images from the pages behind the answer', () => {
    const evidence = emptyEvidence();
    for (let index = 0; index < 20; index++) addImage(evidence, { imageUrl: `https://cdn.com/big-${index}.png`, pageUrl: 'https://big.com/' });
    addImage(evidence, { imageUrl: 'https://cdn.com/used.png', pageUrl: 'https://used.com/' });
    const images = finishEvidence(evidence, '[Used](https://used.com/)')!.images;
    expect(images[0]?.imageUrl).toBe('https://cdn.com/used.png');
    expect(images.filter((image) => image.pageUrl === 'https://big.com/')).toHaveLength(6);
  });

  it('cleans what a page reader puts ahead of a snippet', () => {
    const evidence = emptyEvidence();
    addSource(evidence, { url: 'https://site.com/', snippet: 'Public form controls parsed from HTML (metadata, not a quotation): [{"name":"q"}] Games [Sign in](https://site.com/login) here' });
    expect(evidence.sources[0]?.snippet).toBe('Games Sign in here');
  });

  it('has nothing to show for an answer with no evidence', () => {
    expect(finishEvidence(emptyEvidence(), 'Hello there.')).toBeUndefined();
  });
});
