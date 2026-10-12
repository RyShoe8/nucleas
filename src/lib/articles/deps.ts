import 'server-only';
import { askEngine } from '@/lib/ai/engine/ask';
import { researchSearch } from '@/lib/ai/tools/webSearch';
import { webFetch } from '@/lib/ai/tools/webFetch';
import type { ArticleDeps } from './pipeline';

/** Real dependencies: the AI engine picks the model per need at the organization's cost level (free models first, paid only where the level allows); web search and fetch are the shared tools. */
export const defaultArticleDeps: ArticleDeps = {
  async ask({ need, organizationId, userId, system, user, maxTokens }) {
    const answer = await askEngine({ organizationId, userId, need, system, user, maxTokens });
    return answer ? { text: answer.text, model: answer.model } : null;
  },
  async search(query) {
    const result = await researchSearch(query, { limit: 4, depth: 'standard' });
    return result.hits.map((h) => ({ title: h.title, url: h.url, text: (h.extract || h.snippet || '').trim() }));
  },
  async fetchPage(url) {
    const page = await webFetch(url);
    return page.text ? { title: page.title ?? url, text: page.text } : null;
  },
};
