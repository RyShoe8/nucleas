/** Submitted placements wait on the destination; saved placements were deliberately deferred. */
export function linkNeedsAction(status: string): boolean {
    return status === 'recommended' || status === 'approved';
}
