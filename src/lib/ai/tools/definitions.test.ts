import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/tools/browseRouter', () => ({
  isBrowserWorkerConfigured: () => false,
}));

import { ideChatToolDefinitions } from '@/lib/ai/tools/definitions';

describe('ideChatToolDefinitions', () => {
  it('includes repo tools in full profile', () => {
    const names = ideChatToolDefinitions({ includeImage: false }).map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining(['repo_tree', 'repo_read', 'web_search', 'web_fetch'])
    );
  });

  it('limits plan profile to repo tools', () => {
    const names = ideChatToolDefinitions({ includeImage: true, profile: 'repo' }).map(
      (t) => t.function.name
    );
    expect(names).toEqual(['repo_tree', 'repo_read', 'repo_search', 'repo_history', 'repo_commit']);
  });

  it('omits repo tools when includeRepo is false', () => {
    const names = ideChatToolDefinitions({ includeImage: false, includeRepo: false }).map(
      (t) => t.function.name
    );
    expect(names).not.toContain('repo_tree');
    expect(names).toContain('web_search');
  });
});
