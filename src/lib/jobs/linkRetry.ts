/** Missing record fields and evidence formatting failures do not establish that a placement is unsuitable. */
export function evidenceOnlyLinkFailure(issues: { problem: string }[]): boolean {
  const missingScore = issues.some(({ problem }) => /relevance score is (?:missing|not a valid number)/i.test(problem));
  return issues.length > 0 && issues.every(({ problem }) => /relevance evidence quotes nothing|none of the passages quoted as evidence appear|exact quotation.*copied from that page| is missing\.$| is not a valid (?:number|url|list|date)\.$|no source link for this record|no opportunity page address|relevance evidence must specifically prove|chosen strategy needs specific sourced evidence/i.test(problem)
    || (missingScore && /relevance must score at least 75/i.test(problem)));
}

export function linkRetryBrief(issues: { problem: string }[]): string {
  const action = evidenceOnlyLinkFailure(issues)
    ? 'The problem is incomplete fields or unsupported evidence, not proven ineligibility. Repair the SAME candidate using the exact required field keys. Reopen the SAME candidate page and its submission instructions. Fill missing fields only from the supplied context or live evidence; keep unknowns explicit. Correct the relevance evidence using an exact passage you actually read; preserve the opportunity if it qualifies. Do not invent quotations. Replace it only if the live page does not support eligibility.'
    : 'Replace each failed recommendation with a different eligible opportunity whose page you opened and read in this run.';
  return `These recommendations failed validation:\n${issues.map(issue => `- ${issue.problem}`).join('\n')}\n${action} It must load, be an independent third-party site, show a free self-service way to add a link, and accept this company and its audience. Include at least one exact quotation (25+ characters, in double quotes) from that page in the relevance evidence. Do not guess addresses. Return only the required JSON.`;
}
