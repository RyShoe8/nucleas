'use client';

import type { ContentQuality } from '@/lib/ai/research/contentQuality';

/** Shared across Ask and work results; source passages remain next to the claims they support. */
export default function ContentQualityDetails({ quality }: { quality?: ContentQuality | null }) {
  if (!quality) return null;
  return <section className="space-y-3 rounded-lg border border-border p-3 text-sm" aria-label="Content quality and evidence">
    <h3 className={quality.status === 'ready' ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
      {quality.status === 'ready' ? 'Evidence and editorial checks passed' : quality.status === 'review_failed' ? 'Evidence review incomplete' : 'Draft needs verification'}
    </h3>
    <p className="text-text-secondary">{quality.notes || 'The draft is retained. Resolve the checks below before relying on it.'}</p>
    {!!quality.issues.length && <ul className="list-disc space-y-1 pl-5">{quality.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    {!!quality.coverage.length && <details><summary className="cursor-pointer font-medium">Topic coverage · {quality.coverage.filter(c => c.status === 'supported').length}/{quality.coverage.length}</summary>
      <ul className="mt-2 space-y-2">{quality.coverage.map((item, i) => <li key={`${item.id}-${i}`} className="break-words"><span className="font-medium">{item.question}</span><p className="text-text-secondary">{item.required ? 'Required' : 'Optional'} · {item.status.replace('_', ' ')} · {item.reason}</p></li>)}</ul>
    </details>}
    {!!quality.claims.length && <details><summary className="cursor-pointer font-medium">Claims and supporting passages · {quality.claims.length}</summary>
      <ol className="mt-3 space-y-4">{quality.claims.map((claim, i) => <li key={i} className="min-w-0 space-y-1 break-words">
        <p className="font-medium">{claim.claim}</p>
        <p className="text-text-secondary">{claim.verdict} · {claim.kind} · {claim.scope}</p>
        {claim.sourceUrl && /^https?:\/\//i.test(claim.sourceUrl) && <a className="break-all text-accent underline" href={claim.sourceUrl} target="_blank" rel="noreferrer">{claim.sourceUrl}</a>}
        {claim.quote && <blockquote className="border-l-2 border-border pl-3">{claim.quote}</blockquote>}
        {claim.calculation && <p className="text-xs text-text-secondary">Calculation: {claim.calculation.operation.replaceAll('_', ' ')} · inputs {claim.calculation.inputs.join(', ')} · result {claim.calculation.result} {claim.calculation.unit}</p>}
        <p className="text-xs text-text-secondary">{claim.quoteMatched ? 'Passage matched in code' : 'Passage not matched'} · {claim.stale ? 'Freshness check needed' : `Checked ${claim.checkedAt?.slice(0, 10) ?? 'date unknown'}`}. {claim.reason}</p>
      </li>)}</ol>
    </details>}
    <p className="text-xs text-text-secondary">Checks combine source matching and model review. They do not guarantee search rankings or AI citations.</p>
  </section>;
}
