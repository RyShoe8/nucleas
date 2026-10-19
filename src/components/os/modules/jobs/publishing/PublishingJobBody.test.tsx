import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JobView } from '../JobCard';
import PublishingJobBody from './PublishingJobBody';

function render(canManage: boolean, failed = false, sample = false) {
    const job = {
        id: 'job', status: 'proposed', canManage, request: 'Post new games',
        runs: sample ? [{ id: 'sample', dryRun: true, status: 'needs_review', output: { summary: 'Preview', gaps: [], records: [{ values: { platform: 'Bluesky', post_copy: 'A new game.', target_url: 'https://example.com/games/test' } }] } }] : failed ? [{ id: 'run', dryRun: true, status: 'failed', error: 'Provider unavailable' }] : [],
        publishing: {
            source: { type: 'site', feedUrl: 'https://example.com/sitemap.xml', pathPrefix: '/games/', noun: 'game' },
            channels: [{ platform: 'bluesky', mode: 'manual' }], ready: [], recent: [], examples: {},
        },
    } as unknown as JobView;
    return renderToStaticMarkup(createElement(PublishingJobBody, { job, onChange: () => {} }));
}

describe('publishing approval controls', () => {
    it('lets a manager start the first dry run and makes manual mode explicit', () => {
        const html = render(true);
        expect(html).toContain('Approve and run a dry run');
        expect(html).toContain('manual review card');
        expect(html).toContain('Reject');
    });
    it('shows retry and the failure after a failed sample', () => {
        const html = render(true, true);
        expect(html).toContain('Retry dry run');
        expect(html).toContain('Provider unavailable');
    });
    it('shows the separate game URL and copy action on sample previews', () => {
        const html = render(true, false, true);
        expect(html).toContain('href="https://example.com/games/test"');
        expect(html).toContain('Copy post with link');
    });
    it('does not offer approval to a viewer', () => {
        expect(render(false)).not.toContain('Approve and run a dry run');
        expect(render(false)).toContain('must approve');
    });
});
