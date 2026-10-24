import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RoundupReview } from './ReleaseUpdatesPanel';
import type { RoundupDraft } from '@/lib/roundups/types';

const draft: RoundupDraft = { id: 'draft', companyId: 'company', status: 'draft', title: 'PlayBound update', summary: 'What shipped.', bodyMarkdown: '## New games\n\n[New game](https://playbound.club/games/new-game)', coverageStart: '2026-10-02T00:00:00Z', coverageEnd: '2026-10-23T00:00:00Z', coveredIds: ['game:new'], progress: 'Ready', error: null, publishedUrl: null, createdAt: '', updatedAt: '', details: { sources: [], logs: [], warnings: [] } };
const render = (status: RoundupDraft['status'], canPublish = true) => renderToStaticMarkup(createElement(RoundupReview, { draft: { ...draft, status }, companyName: 'PlayBound', busy: false, canPublish, canEdit: true, canManage: canPublish, onAction: async () => undefined }));
it('offers one clear review decision and preserves the exact game link', () => {
    const html = render('draft');
    expect(html).toContain('Accept and publish');
    expect(html).toContain('Edit inline');
    expect(html).toContain('Reject draft');
    expect(html).toContain('href="https://playbound.club/games/new-game"');
    expect(html).not.toContain('Create update post');
});
it('does not let a regular member publish or reject, and reconciles uncertain publication separately', () => {
    expect(render('draft', false)).not.toContain('Accept and publish');
    expect(render('draft', false)).not.toContain('Reject draft');
    expect(render('publish_uncertain')).toContain('Check publication');
    expect(render('publish_uncertain')).not.toContain('Reject draft');
    expect(render('generating')).not.toContain('Accept and publish');
});
