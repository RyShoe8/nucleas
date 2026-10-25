/** Evidence formatting failures do not establish that a placement is unsuitable. */
export function evidenceOnlyLinkFailure(issues: { problem: string }[]): boolean {
  return issues.length > 0 && issues.every(({ problem }) => /relevance evidence quotes nothing|none of the passages quoted as evidence appear|exact quotation.*copied from that page/i.test(problem));
}

export function linkRetryBrief(issues: { problem: string }[]): string {
  const action = evidenceOnlyLinkFailure(issues)
    ? 'The problem is unsupported or missing quoted evidence, not proven ineligibility. Reopen the SAME candidate page and its submission instructions. Correct the relevance evidence using an exact passage you actually read; preserve the opportunity if it qualifies. Do not invent quotations. Replace it only if the live page does not support eligibility.'
    : 'Replace each failed recommendation with a different eligible opportunity whose page you opened and read in this run.';
  return `These recommendations failed validation:\n${issues.map(issue => `- ${issue.problem}`).join('\n')}\n${action} It must load, be an independent third-party site, show a free self-service way to add a link, and accept this company and its audience. Include at least one exact quotation (25+ characters, in double quotes) from that page in the relevance evidence. Do not guess addresses. Return only the required JSON.`;
}
