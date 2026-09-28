import { describe, expect, it } from 'vitest';
import { describeToolCall, shortModel } from './progress';

describe('progress lines', () => {
  it('describes tool calls in plain language', () => {
    expect(describeToolCall('repo_search', '{"query":"OpenHV","path":"src/games"}')).toBe('Searching the code for “OpenHV” in src/games');
    expect(describeToolCall('repo_read', '{"path":"src/games/openra.ts"}')).toBe('Reading src/games/openra.ts');
    expect(describeToolCall('repo_history', '{"path":"src/games/openra.ts"}')).toBe('Checking recent commits to src/games/openra.ts');
    expect(describeToolCall('repo_commit', '{"sha":"a1b2c3d4e5f6"}')).toBe('Reading commit a1b2c3d');
    expect(describeToolCall('web_search', '{"query":"best casino affiliate sites"}')).toBe('Searching the web for “best casino affiliate sites”');
    expect(describeToolCall('web_fetch', '{"url":"https://www.example.com/page"}')).toBe('Reading example.com');
    expect(describeToolCall('company_metrics', '{"company":"Playbound.club"}')).toBe("Reading Playbound.club's metrics");
    expect(describeToolCall('analytics_traffic_read', '{"company":"Frugal Gambler"}')).toBe('Reading analytics traffic for Frugal Gambler');
    expect(describeToolCall('repo_read', 'not json')).toBe('Reading a file');
  });

  it('shortens long model names and queries', () => {
    expect(shortModel('anthropic/claude-opus-5.5')).toBe('claude-opus-5.5');
    expect(describeToolCall('web_search', JSON.stringify({ query: 'x'.repeat(200) })).length).toBeLessThan(110);
  });
});
