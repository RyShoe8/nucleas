/** Catalog of OpenAI-compatible chat providers for the Admin model registry. */

export type ModelProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'together'
  | 'fireworks'
  | 'openrouter'
  | 'custom';

export type ModelStrength =
  | 'coding'
  | 'reasoning'
  | 'chat'
  | 'vision'
  | 'image_gen'
  | 'embeddings'
  | 'speed'
  | 'long_context';

export type CatalogModel = {
  id: string;
  label: string;
  /** Short “best at” line for UI */
  bestAt: string;
  strengths: ModelStrength[];
  /** Context window in tokens; null when unknown */
  contextTokens: number | null;
  /** Company’s strongest / flagship model (highlighted in pickers). */
  flagship?: boolean;
};

export type ModelProviderOption = {
  id: ModelProviderId;
  label: string;
  /** Default chat-completions endpoint (OpenAI-compatible). */
  endpoint: string;
  models: CatalogModel[];
  /** Shown under the company field */
  hint: string;
  /** Suggested tier when this company is selected */
  defaultTier: 'commercial' | 'local_remote';
};

function m(
  id: string,
  label: string,
  bestAt: string,
  strengths: ModelStrength[],
  contextTokens: number | null,
  flagship = false
): CatalogModel {
  return { id, label, bestAt, strengths, contextTokens, ...(flagship ? { flagship: true } : {}) };
}

/**
 * The gateway speaks OpenAI chat completions. Anthropic and Google expose compatibility endpoints
 * that accept their own API keys; OpenRouter remains a distinct aggregator credential.
 */
export const MODEL_PROVIDERS: ModelProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your OpenAI API key (sk-…).',
    models: [
      m('gpt-6-astra', 'GPT-6 Astra', 'Hardest reasoning and agentic work', ['reasoning', 'coding', 'long_context'], 1_000_000, true),
      m('gpt-5.6-sol', 'GPT-5.6 Sol', 'Balanced flagship for coding and analysis', ['coding', 'reasoning', 'chat'], 256_000),
      m('gpt-5.6-terra', 'GPT-5.6 Terra', 'Strong general work at mid cost', ['chat', 'coding', 'reasoning'], 256_000),
      m('gpt-5.6-luna', 'GPT-5.6 Luna', 'Fast cheap drafts and simple tasks', ['chat', 'speed'], 128_000),
      m('gpt-5.4', 'GPT-5.4', 'High-quality coding and multi-step work', ['coding', 'reasoning', 'chat'], 256_000),
      m('gpt-5.4-mini', 'GPT-5.4 mini', 'Affordable coding assistant', ['coding', 'chat', 'speed'], 128_000),
      m('gpt-5', 'GPT-5', 'General high-capability assistant', ['chat', 'reasoning', 'coding'], 128_000),
      m('gpt-5-mini', 'GPT-5 mini', 'Lightweight everyday chat and edits', ['chat', 'speed'], 128_000),
      m('o3', 'o3', 'Deep reasoning and hard problems', ['reasoning', 'coding'], 200_000),
      m('o4-mini', 'o4-mini', 'Faster reasoning on a budget', ['reasoning', 'speed'], 200_000),
      m('gpt-4.1', 'GPT-4.1', 'Reliable coding and long instructions', ['coding', 'chat', 'long_context'], 1_000_000),
      m('gpt-4.1-mini', 'GPT-4.1 mini', 'Cheap coding and summarization', ['coding', 'chat', 'speed'], 1_000_000),
      m('gpt-4o', 'GPT-4o', 'Multimodal chat and vision Q&A', ['chat', 'vision', 'coding'], 128_000),
      m('gpt-4o-mini', 'GPT-4o mini', 'Fast cheap multimodal helper', ['chat', 'vision', 'speed'], 128_000),
      m('gpt-image-1', 'GPT Image 1', 'OpenAI image generation', ['image_gen'], null),
      m('dall-e-3', 'DALL·E 3', 'High-quality image generation', ['image_gen'], null),
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'Direct Claude API access. Paste an Anthropic Console API key; Anthropic credits apply to these calls.',
    models: [
      m('claude-fable-5', 'Claude Fable 5', 'Advanced reasoning, coding, and agentic work', ['reasoning', 'chat', 'coding', 'long_context'], 1_000_000, true),
      m('claude-opus-5', 'Claude Opus 5', 'Highest-quality writing and complex reasoning', ['reasoning', 'chat', 'coding', 'long_context'], 1_000_000),
      m('claude-opus-4-8', 'Claude Opus 4.8', 'Top-tier analysis and long documents', ['reasoning', 'chat', 'coding', 'long_context'], 1_000_000),
      m('claude-opus-4-7', 'Claude Opus 4.7', 'Deep reasoning and agentic coding', ['reasoning', 'chat', 'coding', 'long_context'], 1_000_000),
      m('claude-opus-4-6', 'Claude Opus 4.6', 'Complex reasoning and coding', ['reasoning', 'chat', 'coding', 'long_context'], 1_000_000),
      m('claude-sonnet-5', 'Claude Sonnet 5', 'Strong everyday coding and writing', ['coding', 'chat', 'reasoning', 'long_context'], 1_000_000),
      m('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'Balanced Sonnet for production work', ['coding', 'chat', 'reasoning', 'long_context'], 1_000_000),
      m('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 'Fast, economical Claude replies', ['chat', 'speed'], 200_000),
    ],
  },
  {
    id: 'google',
    label: 'Google',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your Gemini API key from Google AI Studio. Uses Google’s OpenAI-compatible chat endpoint.',
    models: [
      m('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'Long-context reasoning and analysis', ['reasoning', 'long_context', 'chat'], 1_000_000, true),
      m('gemini-3.8-flash', 'Gemini 3.8 Flash', 'Fast multimodal assistant', ['chat', 'vision', 'speed'], 1_000_000),
      m('gemini-3.7-flash', 'Gemini 3.7 Flash', 'Fast general Gemini work', ['chat', 'speed'], 1_000_000),
      m('gemini-3.6-flash', 'Gemini 3.6 Flash', 'Speed-focused Gemini replies', ['chat', 'speed'], 1_000_000),
      m('gemini-3.5-flash', 'Gemini 3.5 Flash', 'Balanced Flash for chat and vision', ['chat', 'vision', 'speed'], 1_000_000),
      m('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'Cheapest Gemini drafts', ['chat', 'speed'], 1_000_000),
      m('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Strong reasoning with huge context', ['reasoning', 'long_context', 'chat'], 1_000_000),
      m('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast multimodal Gemini', ['chat', 'vision', 'speed'], 1_000_000),
      m('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'Ultra-cheap quick answers', ['chat', 'speed'], 1_000_000),
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your Groq API key.',
    models: [
      m('openai/gpt-oss-120b', 'GPT-OSS 120B', 'Large open model at Groq speed', ['chat', 'reasoning', 'speed'], 128_000, true),
      m('openai/gpt-oss-20b', 'GPT-OSS 20B', 'Smaller open model, very fast', ['chat', 'speed'], 128_000),
      m('qwen/qwen3.8-27b', 'Qwen3.8 27B', 'Qwen chat and light coding on Groq', ['chat', 'coding', 'speed'], 128_000),
      m('qwen/qwen3.6-27b', 'Qwen3.6 27B', 'Fast Qwen assistant', ['chat', 'speed'], 128_000),
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your DeepSeek API key.',
    models: [
      m('deepseek-chat', 'DeepSeek Chat (V3)', 'Cheap strong chat and coding', ['chat', 'coding'], 128_000),
      m('deepseek-reasoner', 'DeepSeek Reasoner (R1)', 'DeepSeek chain-of-thought reasoning', ['reasoning', 'coding'], 128_000, true),
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your Together API key.',
    models: [
      m('meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama 4 Maverick', 'Llama 4 instruct for chat and code', ['chat', 'coding'], 128_000),
      m('meta-llama/Llama-4-Scout-17B-16E-Instruct', 'Llama 4 Scout', 'Faster Llama 4 instruct', ['chat', 'speed'], 128_000),
      m('deepseek-ai/DeepSeek-R1', 'DeepSeek R1', 'Open DeepSeek reasoning', ['reasoning', 'coding'], 128_000),
      m('Qwen/Qwen3-235B-A22B-fp8-tput', 'Qwen3 235B', 'Large Qwen for hard tasks', ['reasoning', 'chat', 'coding'], 128_000, true),
      m('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'Llama 3.1 70B Turbo', 'Strong open chat model', ['chat', 'coding'], 128_000),
      m('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'Llama 3.1 8B Turbo', 'Small fast Llama', ['chat', 'speed'], 128_000),
    ],
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'Paste your Fireworks API key.',
    models: [
      m('accounts/fireworks/models/llama4-maverick-instruct-basic', 'Llama 4 Maverick', 'Llama 4 on Fireworks', ['chat', 'coding'], 128_000),
      m('accounts/fireworks/models/llama4-scout-instruct-basic', 'Llama 4 Scout', 'Faster Llama 4 on Fireworks', ['chat', 'speed'], 128_000),
      m('accounts/fireworks/models/deepseek-r1-0528', 'DeepSeek R1 (0528)', 'Reasoning checkpoint on Fireworks', ['reasoning', 'coding'], 128_000),
      m('accounts/fireworks/models/deepseek-r1', 'DeepSeek R1 (Fast)', 'Fast DeepSeek reasoning', ['reasoning', 'speed'], 128_000),
      m('accounts/fireworks/models/qwen3-235b-a22b', 'Qwen3 235B', 'Large Qwen on Fireworks', ['reasoning', 'chat'], 128_000, true),
      m('accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B', 'Capable open chat', ['chat', 'coding'], 128_000),
      m('accounts/fireworks/models/llama-v3p1-8b-instruct', 'Llama 3.1 8B', 'Small fast Llama', ['chat', 'speed'], 128_000),
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultTier: 'commercial',
    hint: 'One key for many providers. Paste your OpenRouter API key.',
    models: [
      m('openai/gpt-5.6-sol', 'OpenAI GPT-5.6 Sol', 'OpenAI Sol via OpenRouter', ['coding', 'reasoning', 'chat'], 256_000),
      m('openai/gpt-5.6-terra', 'OpenAI GPT-5.6 Terra', 'OpenAI Terra via OpenRouter', ['chat', 'coding'], 256_000),
      m('anthropic/claude-opus-5', 'Anthropic Claude Opus 5', 'Opus-quality via OpenRouter', ['reasoning', 'chat', 'coding'], 200_000, true),
      m('anthropic/claude-sonnet-5', 'Anthropic Claude Sonnet 5', 'Sonnet coding via OpenRouter', ['coding', 'chat'], 200_000),
      m('google/gemini-2.5-pro', 'Google Gemini 2.5 Pro', 'Long-context Gemini via OpenRouter', ['reasoning', 'long_context'], 1_000_000),
      m('google/gemini-2.5-flash', 'Google Gemini 2.5 Flash', 'Fast Gemini via OpenRouter', ['chat', 'vision', 'speed'], 1_000_000),
      m('deepseek/deepseek-r1', 'DeepSeek R1', 'DeepSeek reasoning via OpenRouter', ['reasoning', 'coding'], 128_000),
      m('meta-llama/llama-4-maverick', 'Meta Llama 4 Maverick', 'Llama 4 via OpenRouter', ['chat', 'coding'], 128_000),
    ],
  },
  {
    id: 'custom',
    label: 'Custom / self-hosted',
    endpoint: '',
    defaultTier: 'local_remote',
    hint: 'Your OpenAI-compatible host (e.g. friend’s inference server). Enter endpoint and model id yourself.',
    models: [],
  },
];

export function getModelProvider(id: string): ModelProviderOption | undefined {
  return MODEL_PROVIDERS.find((item) => item.id === id);
}

export function findCatalogModel(modelId: string): CatalogModel | undefined {
  const trimmed = modelId.trim();
  if (!trimmed) return undefined;
  for (const provider of MODEL_PROVIDERS) {
    const hit = provider.models.find((item) => item.id === trimmed);
    if (hit) return hit;
  }
  return undefined;
}

/** True when the model id is allowed for this company credential. */
export function isModelAllowedForProvider(provider: string, model: string): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (provider === 'custom') return true;
  const catalog = getModelProvider(provider);
  if (!catalog) return false;
  return catalog.models.some((item) => item.id === trimmed);
}

export function slugifyModelKey(parts: string[]): string {
  const base = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
  const suffix = Date.now().toString(36).slice(-4);
  const key = `${base || 'model'}-${suffix}`;
  return /^[a-z]/.test(key) ? key : `m-${key}`.slice(0, 64);
}

/** Company-only name for UI (never includes a model suffix). */
export function companyDisplayName(input: { label: string; provider?: string | null }): string {
  const provider = input.provider ?? 'custom';
  const catalog = getModelProvider(provider);
  if (catalog && provider !== 'custom') return catalog.label;
  const label = input.label.trim();
  const sep = label.indexOf(' · ');
  if (sep > 0) {
    const head = label.slice(0, sep).trim();
    if (head) return head;
  }
  return label || catalog?.label || provider;
}

/**
 * If a stored credential label still looks like legacy "Company · Model",
 * return the cleaned company-only label; otherwise null.
 */
export function cleanedCompanyLabel(input: { label: string; provider?: string | null }): string | null {
  const label = input.label.trim();
  if (!label.includes(' · ')) return null;
  const next = companyDisplayName(input);
  return next && next !== label ? next : null;
}

export function formatContextTokens(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return 'Unknown';
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(tokens);
}

/** Amber highlight for the company’s strongest model in native `<select>` options. */
export const FLAGSHIP_MODEL_OPTION_STYLE = { color: '#b45309', fontWeight: 600 } as const;

/**
 * Compact model name for pickers, diorama, and summaries — e.g. "Qwen 3", "GPT 5.6", "Astra 6".
 * Full API ids are unchanged elsewhere.
 */
export function shortModelDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const gptLabel = trimmed.match(/^GPT[-\s]?([\d]+(?:\.[\d]+)?)\s*(.*)$/i);
  if (gptLabel) {
    const version = gptLabel[1]!;
    const rest = (gptLabel[2] ?? '').trim();
    if (/^astra$/i.test(rest)) return `Astra ${version}`;
    return `GPT ${version}`;
  }

  const segment = (trimmed.includes('/') ? trimmed.split('/').pop()! : trimmed).trim();
  const slug = segment.toLowerCase();

  const qwen = slug.match(/^qwen([0-9]+(?:\.[0-9]+)?)/);
  if (qwen) return `Qwen ${qwen[1]}`;

  const gptSlug = slug.match(/^gpt[-_.]?([\d]+(?:\.[\d]+)?)/);
  if (gptSlug) {
    if (/astra/.test(slug)) return `Astra ${gptSlug[1]}`;
    return `GPT ${gptSlug[1]}`;
  }

  const oSeries = slug.match(/^(o\d+(?:\.\d+)?)(?:[-_]|$)/);
  if (oSeries) {
    return slug.includes('mini') ? `${oSeries[1]!.toUpperCase()} mini` : oSeries[1]!.toUpperCase();
  }

  const claude = slug.match(/claude[-_](opus|sonnet|haiku)[-_]?([\d]+(?:\.[\d]+)?)?/);
  if (claude) {
    const tier = claude[1]!.charAt(0).toUpperCase() + claude[1]!.slice(1);
    return claude[2] ? `Claude ${tier} ${claude[2]}` : `Claude ${tier}`;
  }

  const gemini = slug.match(/gemini[-_.]?([\d]+(?:\.[\d]+)?)/);
  if (gemini) return `Gemini ${gemini[1]}`;

  const astraOnly = trimmed.match(/\bastra\s*([\d]+(?:\.[\d]+)?)\b/i);
  if (astraOnly) return `Astra ${astraOnly[1]}`;

  if (
    !trimmed.includes('/') &&
    trimmed.length <= 32 &&
    !/instruct|awq|coder-\d|\/|_/i.test(trimmed)
  ) {
    return trimmed;
  }

  const generic = slug.match(/^([a-z][a-z0-9]*)[-_.]?([\d]+(?:\.[\d]+)?)/);
  if (generic && generic[1]!.length >= 2) {
    const brand = generic[1]!.charAt(0).toUpperCase() + generic[1]!.slice(1);
    return `${brand} ${generic[2]}`;
  }

  return segment.length > 36 ? `${segment.slice(0, 36)}…` : segment;
}

export function modelOptionLabel(input: {
  label: string;
  bestAt?: string;
  flagship?: boolean;
}): string {
  const short = shortModelDisplayName(input.label);
  const base = input.bestAt ? `${short} — ${input.bestAt}` : short;
  return input.flagship ? `★ ${base}` : base;
}
