/**
 * Looks things up in the repository on behalf of a model that cannot. The free Worker and Critic models
 * often make no tool calls at all, so a statement like "games.ts has no slug: \"openhv\"" is a guess, and a
 * Critic that believes it sends the plan round in circles. When the Critic asks for a check ("does games.ts
 * contain slug: \"openhv\"?"), Nucleas runs it against the repository and returns the lines, or their absence.
 */
import { occurrencesOf, squash } from './claimCheck';

const PATH_LIKE = /(?:[\w@.~-]+\/)*[\w@.~-]+\.[A-Za-z0-9]{1,6}\b/g;
const QUOTED = /'([^'\n]{3,80})'|"([^"\n]{3,80})"|`([^`\n]{3,80})`/g;
const looksLikePath = (t: string) => /^(?:[\w@.~-]+\/)*[\w@.~-]+\.[A-Za-z0-9]{1,6}$/.test(t.trim());

/** Files named in the text: full paths, or bare names ("games.ts") that match exactly one file. */
function namedFiles(files: Map<string, string>, text: string): string[] {
  const out = new Set<string>();
  const byBase = new Map<string, string[]>();
  for (const path of files.keys()) {
    const base = path.split('/').pop()!.toLowerCase();
    byBase.set(base, [...(byBase.get(base) ?? []), path]);
  }
  for (const m of text.matchAll(PATH_LIKE)) {
    const token = m[0].replace(/^[./]+/, '');
    if (files.has(token)) { out.add(token); continue; }
    const suffix = [...files.keys()].filter((p) => p.endsWith(`/${token}`));
    if (suffix.length === 1) { out.add(suffix[0]); continue; }
    const matches = byBase.get(token.split('/').pop()!.toLowerCase());
    if (matches?.length === 1) out.add(matches[0]);
  }
  return [...out].slice(0, 4);
}

/** Things to look for: quoted code or names, minus the paths. */
function searchTokens(text: string, extra: string[]): string[] {
  const quoted = [...text.matchAll(QUOTED)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()).filter((t) => t.length >= 3 && !looksLikePath(t));
  return [...new Set([...quoted, ...extra.filter((t) => t.length >= 4)])].slice(0, 5);
}

export function repoLookups(files: Map<string, string>, requests: string[], terms: string[] = []): string {
  const text = requests.filter(Boolean).join('\n');
  const named = namedFiles(files, text);
  const tokens = searchTokens(text, terms);
  if (!tokens.length) return '';
  const lines: string[] = [];
  const scopeFiles = named.length ? named : [...files.keys()];
  for (const token of tokens) {
    const fragment = squash(token);
    const found: { file: string; line: number }[] = [];
    for (const file of scopeFiles) {
      for (const line of occurrencesOf(files.get(file) ?? '', fragment, true).slice(0, 3)) found.push({ file, line });
      if (found.length >= 4) break;
    }
    if (!found.length) {
      lines.push(`- \`${token}\`: does not occur ${named.length ? `in ${named.join(', ')}` : 'anywhere in the repository'}.`);
      continue;
    }
    for (const hit of found.slice(0, 4)) {
      const source = (files.get(hit.file) ?? '').split('\n')[hit.line - 1] ?? '';
      lines.push(`- \`${token}\`: ${hit.file}:${hit.line}: \`${source.trim().slice(0, 140)}\``);
    }
  }
  return lines.length
    ? ['Repository lookups run by Nucleas for these checks (facts from the code, not model claims):', ...lines].join('\n').slice(0, 2500)
    : '';
}
