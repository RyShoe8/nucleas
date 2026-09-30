/**
 * Live progress for long AI requests: short, plain-language lines ("Searching the code for
 * “OpenHV”") that the Ask window shows while it works.
 */

export type ProgressFn = (text: string) => void;

function args(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown, max = 80): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function host(url: unknown): string {
  try {
    return new URL(String(url)).host.replace(/^www\./, '');
  } catch {
    return 'a web page';
  }
}

/** Words for a capability tool name like "analytics_traffic_read". */
function capabilityWords(name: string): string {
  const parts = name.split('_');
  const verb = parts.at(-1);
  const subject = parts.slice(0, -1).join(' ');
  if (verb === 'read') return `Reading ${subject}`;
  if (verb === 'create') return `Creating ${subject}`;
  if (verb === 'send') return `Sending ${subject}`;
  if (verb === 'update') return `Updating ${subject}`;
  return name.replace(/_/g, ' ');
}

/** One tool call, described for a person. */
export function describeToolCall(name: string, argumentsJson: string): string {
  const a = args(argumentsJson);
  const company = str(a.company, 60);
  switch (name) {
    case 'repo_search':
      return `Searching the code for “${str(a.query)}”${str(a.path) ? ` in ${str(a.path)}` : str(a.glob) ? ` in ${str(a.glob)}` : ''}`;
    case 'repo_references':
      return a.direction === 'uses' ? `Tracing what ${str(a.path, 120) || 'a page'} uses` : `Tracing where ${str(a.path, 120) || 'a file'} is used`;
    case 'repo_read':
      return `Reading ${str(a.path, 120) || 'a file'}`;
    case 'repo_tree':
      return `Looking through ${str(a.path, 120) || 'the repository'}`;
    case 'repo_history':
      return `Checking recent commits${str(a.path) ? ` to ${str(a.path)}` : ''}`;
    case 'repo_commit':
      return `Reading commit ${str(a.sha).slice(0, 7)}`;
    case 'web_search':
      return `Searching the web for “${str(a.query)}”`;
    case 'web_fetch':
      return `Reading ${host(a.url)}`;
    case 'browser_navigate':
      return `Opening ${host(a.url)} in a browser`;
    case 'image_search':
      return `Searching for images of “${str(a.query)}”`;
    case 'image_generate':
      return 'Generating an image';
    case 'company_metrics':
      return `Reading ${company || 'the company'}'s metrics`;
    case 'company_activity':
      return `Checking ${company || 'the company'}'s recent changes`;
    case 'list_companies':
      return 'Listing your companies';
    default:
      return `${capabilityWords(name)}${company ? ` for ${company}` : ''}`;
  }
}

/** A model name short enough for a status line ("anthropic/claude-opus-5.5" → "claude-opus-5.5"). */
export function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}
