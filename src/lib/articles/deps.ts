import 'server-only';
import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';
import { readEngineSettings, selectModel } from '@/lib/ai/engine/select';
import { assistantLedgerProjectId } from '@/lib/ai/company/assistantLedger';
import { researchSearch } from '@/lib/ai/tools/webSearch';
import { webFetch } from '@/lib/ai/tools/webFetch';
import type { ArticleDeps } from './pipeline';

/** Real dependencies: the organization's AI engine picks the model per need, web search and fetch are the shared tools. */
export const defaultArticleDeps: ArticleDeps = {
  async ask({ need, organizationId, userId, system, user, maxTokens }) {
    const settings = await readEngineSettings(organizationId);
    const pick = await selectModel(organizationId, need, settings.defaultCostLevel, { settings });
    if (!pick.primary) return null;
    const turn = await attemptCompanyCredentialChat({
      systemPrompt: system,
      organizationId,
      projectId: assistantLedgerProjectId(organizationId),
      userId,
      userText: user,
      priorTurns: [],
      modelProfileId: pick.primary.profileId,
      model: pick.primary.model,
      includeRepoTools: false,
      includeImageTool: false,
      toolProfile: 'none',
      forcePlain: true,
      stopOnUpstreamFailure: true,
      maxOutputTokensOverride: maxTokens,
    });
    return turn.role === 'assistant' && turn.text.trim() ? { text: turn.text.trim(), model: pick.primary.model } : null;
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
