import { expect, it } from 'vitest';
import { linkNeedsAction } from './linkAttention';

it('keeps recommendations and approved placements awaiting submission in human review', () => {
    expect(['recommended', 'approved'].filter(linkNeedsAction)).toEqual(['recommended', 'approved']);
    for (const status of ['saved', 'submitted', 'live', 'rejected', 'submission_rejected', 'removed', 'expired', 'nonexistent']) expect(linkNeedsAction(status)).toBe(false);
});
