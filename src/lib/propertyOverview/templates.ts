const IRREGULAR_SINGULAR: Record<string, string> = {
  categories: 'category', people: 'person', news: 'news', series: 'series',
};

function words(segment: string): string {
  return decodeURIComponent(segment).replace(/^:/, '').replace(/[-_]+/g, ' ').trim();
}

function singular(value: string): string {
  const normalized = words(value).toLowerCase();
  if (IRREGULAR_SINGULAR[normalized]) return IRREGULAR_SINGULAR[normalized];
  if (normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('sses')) return normalized.slice(0, -2);
  if (normalized.endsWith('s') && !normalized.endsWith('ss')) return normalized.slice(0, -1);
  return normalized;
}

function title(value: string): string {
  const normalized = words(value);
  return normalized ? normalized.replace(/^./, (letter) => letter.toUpperCase()) : 'Page';
}

function semanticRouteName(route: string): string | null {
  const parts = route.split('/').filter(Boolean);
  if (!parts.some((part) => part.startsWith(':'))) return null;
  const sectionWords = words(parts[0] ?? 'page');
  const section = sectionWords.includes(' ') ? sectionWords.toLowerCase() : singular(sectionWords);
  if (parts.length === 2 && parts[1].startsWith(':')) return `${title(section)} details`;
  if (parts.length === 3 && parts[1].startsWith(':') && !parts[2].startsWith(':')) return `${title(section)} ${words(parts[2]).toLowerCase()}`;
  if (parts.length === 4 && parts[1].startsWith(':') && parts[3].startsWith(':')) return `${title(section)} ${singular(parts[2])} details`;
  const staticParts = parts.filter((part) => !part.startsWith(':')).map(words);
  return `${title(staticParts.join(' '))} details`;
}

/** Name a template from the site's own route vocabulary, with no property-specific taxonomy. */
export function templateName(routes: string[]): string {
  const patterns = [...new Set(routes)];
  for (const pattern of patterns) {
    const semantic = semanticRouteName(pattern);
    if (semantic) return semantic;
  }
  const pattern = patterns[0] ?? '/';
  if (pattern === '/') return 'Homepage';
  const section = pattern.split('/').filter(Boolean)[0] ?? '';
  if (section === 'privacy' || section === 'terms' || section === 'standards') return 'Policy and standards';
  return title(section);
}
