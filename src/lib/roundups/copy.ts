import { completeExcerpt, type Source } from './sources';

export function sourceRoundupCopy(name: string, sources: Source[], generic = false) {
  const games = sources.filter(s => !s.id.startsWith('github:'));
  const releases = sources.filter(s => s.id.startsWith('github:'));
  const item = (s: Source) => `- [${s.title.replace(/[\[\]<>]/g, '')}](${s.url}): ${completeExcerpt(s.description.split('\n').find(l => l.trim()) || 'Now available.')}`;
  const platform = releases.map(s => s.id.includes(':production:')
    ? `### ${s.description.split('\n')[0].replace(/:$/, '')}\n\n${s.description.split('\n').filter(l => l.startsWith('- ')).join('\n')}\n\n[View changes](${s.url})`
    : item(s)).join('\n\n');
  return {
    title: `${name} release roundup`.slice(0, 160),
    summary: `${games.length} new ${generic ? 'content items' : 'games'}${releases.length ? ', plus platform additions, improvements and fixes' : ''}.`,
    bodyMarkdown: [releases.length ? `## Platform updates\n\n${platform}` : '', games.length ? `## New ${generic ? 'updates' : 'games'}\n\n${games.map(item).join('\n')}` : ''].filter(Boolean).join('\n\n'),
  };
}
