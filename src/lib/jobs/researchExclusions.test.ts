import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { researchExclusions } from './researchEvidence';

describe('sites a casino discovery run must not recommend', () => {
  it('excludes the full catalog, the candidate queue and the Don’t add list', () => {
    const inventory = JSON.stringify({
      fullCatalog: [{ website_url: 'https://www.listed.com/', login_url: 'https://play.listed.com/login' }],
      candidateQueue: [{ domain: 'waiting.com', name: 'Waiting', status: 'review' }],
      dontAddList: [{ domain: 'never.com', name: 'Never', status: 'rejected' }],
    });
    expect([...researchExclusions(inventory, ['Owned.com'])].sort()).toEqual(['listed.com', 'never.com', 'owned.com', 'play.listed.com', 'waiting.com']);
  });
});
