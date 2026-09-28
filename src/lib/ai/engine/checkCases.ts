import type { ModelToolRequest, ToolDefinition } from '@nucleas/ai-contracts';

/**
 * The work samples Nucleas measures free models on. Each is small, but hard enough that models
 * differ: follow-ups and company names in routing, similar tools and multi-step calls, facts that
 * must be combined or that contradict common knowledge, and exact code edits scored by applying them.
 */

export type ToolMessages = ModelToolRequest['messages'];
type Turn = { role: 'user' | 'assistant'; text: string };

// Routing ---------------------------------------------------------------------------------------

export const CHECK_COMPANIES = ['Playbound.club', 'Frugal Gambler'];
export const CHECK_CODE_COMPANIES = ['Playbound.club', 'Frugal Gambler'];

export const ROUTING_CASES: { prior?: Turn[]; text: string; route: 'answer' | 'code_change' | 'job'; company: string | null }[] = [
  { text: 'How many visitors did PlayBound get last week compared to the week before?', route: 'answer', company: 'Playbound.club' },
  { text: 'On the PlayBound game servers page, remove the OpenHV listing that shows under OpenRA.', route: 'code_change', company: 'Playbound.club' },
  { text: 'Every day, earn one dofollow backlink for a Frugal Gambler page.', route: 'job', company: 'Frugal Gambler' },
  {
    prior: [
      { role: 'user', text: 'The logo on frugalgambler.club looks blurry on phones.' },
      { role: 'assistant', text: 'It is served as a 120px PNG and scaled up. Want me to plan a fix?' },
    ],
    text: 'yes go ahead',
    route: 'code_change',
    company: 'Frugal Gambler',
  },
  { text: 'Research the game Factorio and add its details to the PlayBound catalog.', route: 'job', company: 'Playbound.club' },
  { text: 'Why did Frugal Gambler signups drop this week?', route: 'answer', company: 'Frugal Gambler' },
  {
    prior: [
      { role: 'user', text: 'What are the top pages on PlayBound?' },
      { role: 'assistant', text: 'The top pages are /games, /servers and /blog.' },
    ],
    text: 'Each week, write a short blog post about the most played game and publish it there.',
    route: 'job',
    company: 'Playbound.club',
  },
  { text: 'Add a dark mode toggle to the Frugal Gambler header.', route: 'code_change', company: 'Frugal Gambler' },
  { text: "Thanks, that's all for now.", route: 'answer', company: null },
  { text: 'Every Monday, collect new Steam releases with multiplayer support and add them to the PlayBound catalog.', route: 'job', company: 'Playbound.club' },
  { text: 'The signup button on playbound.club/join does nothing when I click it.', route: 'code_change', company: 'Playbound.club' },
  { text: "Compare PlayBound's revenue this month to last month.", route: 'answer', company: 'Playbound.club' },
];

// Tools -----------------------------------------------------------------------------------------

export const CHECK_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'company_metrics',
      description: "Read a company's recorded numbers (visitors, revenue or signups) over the last N days.",
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name' },
          metric: { type: 'string', enum: ['visitors', 'revenue', 'signups'] },
          days: { type: 'integer', description: 'How many days back' },
        },
        required: ['company', 'metric', 'days'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'company_activity',
      description: 'Read what changed recently for a company: deploys, merged code, content and settings changes.',
      parameters: {
        type: 'object',
        properties: { company: { type: 'string' }, days: { type: 'integer' } },
        required: ['company'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_search',
      description: "Search a company's code repository for text; returns matching file paths and lines.",
      parameters: {
        type: 'object',
        properties: { company: { type: 'string' }, query: { type: 'string', description: 'Text to find' } },
        required: ['company', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_read',
      description: "Read one file from a company's repository by its path.",
      parameters: {
        type: 'object',
        properties: { company: { type: 'string' }, path: { type: 'string' } },
        required: ['company', 'path'],
      },
    },
  },
];

const TOOL_SYSTEM = 'You help run a group of companies: Playbound.club and Frugal Gambler. Use a tool when one can answer the request; do not call tools for small talk.';
const ask = (text: string): ToolMessages => [
  { role: 'system', content: TOOL_SYSTEM },
  { role: 'user', content: text },
];

export type ExpectCall = (call: { name: string; args: Record<string, unknown> } | null) => boolean;

export const TOOL_CASES: { label: string; messages: ToolMessages; expect: ExpectCall }[] = [
  {
    label: 'visitors over 14 days',
    messages: ask('How many visitors did Playbound.club have over the past 14 days?'),
    expect: (c) => c?.name === 'company_metrics' && /playbound/i.test(String(c.args.company)) && c.args.metric === 'visitors' && Number(c.args.days) === 14,
  },
  {
    label: 'recent changes (activity, not metrics)',
    messages: ask("What changed on Frugal Gambler's site this week?"),
    expect: (c) => c?.name === 'company_activity' && /frugal/i.test(String(c.args.company)),
  },
  {
    label: 'find code',
    messages: ask('Where in the PlayBound code is the OpenHV game server listing defined?'),
    expect: (c) => c?.name === 'repo_search' && /openhv/i.test(String(c.args.query)),
  },
  {
    label: 'second step uses the first result',
    messages: [
      ...ask('Show me the code that defines the OpenHV listing on PlayBound.'),
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'repo_search', arguments: '{"company":"Playbound.club","query":"OpenHV"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"matches":[{"path":"src/data/gameServers.ts","line":88,"text":"  { id: \'openhv\', name: \'OpenHV\', parent: \'openra\' },"}]}' },
    ],
    expect: (c) => c?.name === 'repo_read' && String(c.args.path).replace(/^\.?\//, '') === 'src/data/gameServers.ts',
  },
  {
    label: 'revenue over 30 days',
    messages: ask('How much revenue did Frugal Gambler make in the last 30 days?'),
    expect: (c) => c?.name === 'company_metrics' && /frugal/i.test(String(c.args.company)) && c.args.metric === 'revenue' && Number(c.args.days) === 30,
  },
  { label: 'no tool for small talk', messages: ask("Thanks, that's all for now."), expect: (c) => c === null },
];

// Grounded answers --------------------------------------------------------------------------------

const NOTES = [
  'PlayBound release notes.',
  'Version 2.2 (3 July 2026): added 28 new games; the catalog reached 1,163 games. The server browser gained region filters.',
  'Version 2.3 (14 August 2026): added 41 new games; the catalog reached 1,204 games. Search was rebuilt to rank by player count. The OpenHV listing was moved under OpenRA.',
  'Version 2.4 (planned for October 2026): will add account linking with Steam. No new games are planned for 2.4.',
  'Support answers within 2 business days.',
  'Minecraft is not in the PlayBound catalog; its servers are listed in a separate directory.',
].join('\n');

export const GROUNDED_SYSTEM = `Answer only from these notes. If the notes do not say, reply that the notes do not say. Keep answers short.\n\n${NOTES}`;

const saysNotStated = (t: string) => /(not|n't)\s+(say|said|mention|state|specif|includ|provide|contain)|no (information|mention|details?)|unknown|not (in|found in) the notes/i.test(t);

export const GROUNDED_CASES: { question: string; pass: (text: string) => boolean }[] = [
  { question: 'How many games were added across versions 2.2 and 2.3 combined?', pass: (t) => /\b69\b/.test(t) },
  { question: 'Which version moved the OpenHV listing, and where did it go?', pass: (t) => /2\.3/.test(t) && /openra/i.test(t) },
  { question: 'Is Minecraft in the PlayBound catalog?', pass: (t) => /\b(no|not)\b/i.test(t) && !/^\W*yes\b/i.test(t) },
  { question: 'How many new games will version 2.4 add?', pass: (t) => /\b(no|none|zero|0)\b/i.test(t) && !/\b(28|41)\b/.test(t) },
  { question: 'Who designed the logo for version 2.3?', pass: saysNotStated },
  { question: 'How many games were in the catalog before version 2.2?', pass: (t) => /1[,.\s]?135/.test(t) },
];

// Code edits --------------------------------------------------------------------------------------

export const EDIT_SYSTEM =
  'You edit code. Reply with JSON only: {"edits": [{"find": "exact text currently in the file", "replace": "new text"}]}. Each "find" must match the file exactly once, including spaces. Change nothing else.';

export const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'], additionalProperties: false },
    },
  },
  required: ['edits'],
  additionalProperties: false,
};

const SERVERS = `export const gameServers = [
  { id: 'openra', name: 'OpenRA', parent: null },
  { id: 'openhv', name: 'OpenHV', parent: 'openra' },
  { id: 'openhv', name: 'OpenHV', parent: null },
  { id: 'wesnoth', name: 'Battle for Wesnoth', parent: null },
];
`;

const PRICES = `export function formatPrice(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

export function priceLabel(item: { priceCents: number; name: string }): string {
  return \`\${item.name}: \${formatPrice(item.priceCents)}\`;
}
`;

/** Compare code ignoring indentation changes and blank lines. */
export const sameCode = (a: string, b: string) => {
  const norm = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  return norm(a) === norm(b);
};

export const EDIT_CASES: { label: string; file: string; path: string; task: string; pass: (result: string) => boolean }[] = [
  {
    label: 'remove the nested listing',
    file: SERVERS,
    path: 'src/data/gameServers.ts',
    task: "Remove the OpenHV entry that is listed under OpenRA (parent 'openra'). Keep the standalone OpenHV entry.",
    pass: (r) => sameCode(r, SERVERS.replace("  { id: 'openhv', name: 'OpenHV', parent: 'openra' },\n", '')),
  },
  {
    label: 'rename everywhere',
    file: PRICES,
    path: 'src/lib/prices.ts',
    task: 'Rename the function formatPrice to formatUsd everywhere in this file.',
    pass: (r) => sameCode(r, PRICES.replace(/formatPrice/g, 'formatUsd')),
  },
  {
    label: 'small behaviour change',
    file: PRICES,
    path: 'src/lib/prices.ts',
    task: "In priceLabel, show the word Free instead of the price when priceCents is 0. Leave formatPrice unchanged.",
    pass: (r) =>
      /['"`]Free['"`]|:\s*Free\b/.test(r) &&
      /priceCents\s*===?\s*0|!\s*item\.priceCents|priceCents\s*<=?\s*0|0\s*===?\s*item\.priceCents/.test(r) &&
      r.includes("return '$' + (cents / 100).toFixed(2);") &&
      /formatPrice\(item\.priceCents\)/.test(r),
  },
];

/** Applies find/replace edits; null when any find is missing or ambiguous. */
export function applyEdits(file: string, edits: unknown): string | null {
  if (!Array.isArray(edits) || !edits.length) return null;
  let out = file;
  for (const edit of edits) {
    const find = (edit as { find?: unknown })?.find;
    const replace = (edit as { replace?: unknown })?.replace;
    if (typeof find !== 'string' || typeof replace !== 'string' || !find) return null;
    const first = out.indexOf(find);
    if (first < 0 || out.indexOf(find, first + 1) >= 0) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}
