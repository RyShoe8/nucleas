import { createHash } from 'node:crypto';

export type RepositoryEvidenceReceipt = {
  kind: 'repository';
  tool: 'repo_search' | 'repo_read';
  path: string;
  revision: string;
  startLine: number;
  endLine: number;
  sha256: string;
};

/** A compact, tamper-evident description of the exact repository text supplied to a model. */
export function repositoryEvidenceReceipt(input: Omit<RepositoryEvidenceReceipt, 'kind' | 'sha256'> & { content: string }): RepositoryEvidenceReceipt {
  return {
    kind: 'repository',
    tool: input.tool,
    path: input.path.slice(0, 500),
    revision: input.revision.slice(0, 64),
    startLine: Math.max(1, Math.floor(input.startLine)),
    endLine: Math.max(input.startLine, Math.floor(input.endLine)),
    sha256: createHash('sha256').update(input.content, 'utf8').digest('hex'),
  };
}

export function dedupeEvidenceReceipts(receipts: RepositoryEvidenceReceipt[]): RepositoryEvidenceReceipt[] {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = `${receipt.tool}|${receipt.path}|${receipt.revision}|${receipt.startLine}|${receipt.endLine}|${receipt.sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}
