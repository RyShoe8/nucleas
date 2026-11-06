'use client';

import { useState } from 'react';
import type { AnswerEvidence } from '@/lib/ai/evidence';

export interface AnswerStage {
  stage: string;
  model?: string;
  free?: boolean;
  costMicros?: number | null;
  note?: string;
}

export function formatCost(micros: number): string {
  if (micros === 0) return '$0.00';
  return micros < 10_000 ? '<$0.01' : `$${(micros / 1_000_000).toFixed(2)}`;
}

export function modelName(model?: string): string {
  return (model ?? '').split('/').pop()?.replace(/-(instruct|it|awq|fp8|qat).*$/i, '') ?? '';
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const STEP_NAMES: Record<string, string> = { plan: 'Planned the approach', research: 'Researched', work: 'Wrote the answer', review: 'Reviewed the answer', job: 'Designed a job' };

/** A stage's note as a reader would write it: "tools: web_search" becomes "Used web search". */
function readableNote(note?: string): string | undefined {
  if (!note) return undefined;
  const text = note.replace(/^tools: (.*)$/, (_, tools: string) => `Used ${tools.replace(/_/g, ' ')}`);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface AnswerStep {
  name: string;
  detail?: string;
  model?: string;
  cost: string;
  warning?: boolean;
}

/** One step per stage, in plain words. A step that used no model says so instead of leaving a blank. */
export function describeStages(stages: AnswerStage[]): AnswerStep[] {
  return stages.flatMap((stage): AnswerStep[] => {
    if (stage.stage === 'fetch') {
      const lookups = Number(/(\d+) job\(s\)/.exec(stage.note ?? '')?.[1] ?? 0);
      const searches = Number(/(\d+) web search\(es\)/.exec(stage.note ?? '')?.[1] ?? 0);
      if (!lookups && !searches) return [];
      const parts = [lookups ? plural(lookups, 'company data lookup') : '', searches ? plural(searches, 'web search', 'web searches') : ''].filter(Boolean);
      return [{ name: 'Gathered information', detail: parts.join(' and '), cost: 'No model' }];
    }
    if (stage.stage === 'check') {
      const passed = Boolean(stage.note?.startsWith('all'));
      return [{ name: passed ? 'Checked the numbers' : 'Numbers need a look', detail: readableNote(stage.note), cost: 'No model', warning: !passed }];
    }
    const cost = stage.free ? 'Free' : stage.costMicros != null ? formatCost(stage.costMicros) : stage.model ? 'Unknown' : '';
    return [{ name: STEP_NAMES[stage.stage] ?? stage.stage, detail: readableNote(stage.note), model: modelName(stage.model) || undefined, cost, warning: /^skipped|could not/i.test(stage.note ?? '') }];
  });
}

export function detailsSummary(input: { evidence?: AnswerEvidence | null; steps: AnswerStep[]; costMicros?: number | null }): string {
  const sources = input.evidence?.sources.length ?? 0;
  const images = input.evidence?.images.length ?? 0;
  const data = input.evidence?.data.length ?? 0;
  return [
    sources ? plural(sources, 'source') : '',
    images ? plural(images, 'image') : '',
    data ? plural(data, 'data lookup') : '',
    input.steps.length ? plural(input.steps.length, 'step') : '',
    input.costMicros != null ? formatCost(input.costMicros) : '',
  ].filter(Boolean).join(' · ');
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const HEADING = 'mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary';

function ImageTile({ image }: { image: AnswerEvidence['images'][number] }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <li className="min-w-0">
      <a href={image.pageUrl ?? image.imageUrl} target="_blank" rel="noreferrer" title={image.title} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- pictures from other sites, shown as found */}
        <img src={image.imageUrl} alt={image.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-24 w-full rounded border border-border object-cover" />
        <span className="mt-0.5 block truncate text-[10px] text-text-secondary">{image.title}</span>
      </a>
    </li>
  );
}

/**
 * What an answer is based on and how it was made, one click away. Closed, nothing below loads, so reading an answer
 * contacts no other site. Pages and images come from the web, so they are only ever shown as text and links.
 */
export default function AnswerDetails({ stages, evidence, contextSources, costMicros, defaultOpen = false }: { stages?: AnswerStage[]; evidence?: AnswerEvidence | null; contextSources?: string[]; costMicros?: number | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = describeStages(stages ?? []);
  const sources = evidence?.sources ?? [];
  const images = evidence?.images ?? [];
  const data = evidence?.data ?? [];
  const context = contextSources ?? [];
  const summary = detailsSummary({ evidence, steps, costMicros });
  if (!summary && !context.length) return null;
  // Only a cost to report: say it, with no button that would open onto nothing.
  if (!steps.length && !sources.length && !images.length && !data.length && !context.length) return <p className="mt-2 border-t border-border pt-1.5 text-[11px] text-text-secondary">{summary}</p>;
  return (
    <div className="mt-2 border-t border-border pt-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left text-[11px] text-text-secondary hover:text-text-primary">
        <span className="min-w-0 truncate">{summary || 'Company context'}</span>
        <span className="shrink-0">{open ? 'Hide details' : 'Show details'}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-4 text-[11px]">
          {steps.length ? (
            <section>
              <h4 className={HEADING}>How this was answered</h4>
              <ol className="space-y-1.5">
                {steps.map((step, index) => (
                  <li key={`${step.name}-${index}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className={step.warning ? 'text-amber-400' : 'text-text-primary'}>{step.name}</span>
                      {step.model ? <span className="text-text-secondary"> with {step.model}</span> : null}
                      {step.detail ? <span className="block break-words text-text-secondary">{step.detail}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-text-secondary">{step.cost}</span>
                  </li>
                ))}
              </ol>
              {costMicros != null ? <p className="mt-1.5 flex justify-between gap-3 border-t border-border pt-1 text-text-primary"><span>Total</span><span className="tabular-nums">{formatCost(costMicros)}</span></p> : null}
            </section>
          ) : null}
          {sources.length ? (
            <section>
              <h4 className={HEADING}>Sources · {sources.length}</h4>
              <ul className="space-y-2">
                {sources.map((source) => (
                  <li key={source.url} className="min-w-0">
                    <a href={source.url} target="_blank" rel="noreferrer" className="break-words text-primary hover:underline">{source.title}</a>
                    <span className="block text-text-secondary">{hostOf(source.url)}{source.cited ? ' · used in the answer' : ''}</span>
                    {source.snippet ? <span className="block break-words text-text-secondary">{source.snippet}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {images.length ? (
            <section>
              <h4 className={HEADING}>Images · {images.length}</h4>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{images.map((image) => <ImageTile key={image.imageUrl} image={image} />)}</ul>
            </section>
          ) : null}
          {data.length ? (
            <section>
              <h4 className={HEADING}>Company data used · {data.length}</h4>
              <ul className="space-y-2">
                {data.map((row, index) => (
                  <li key={`${row.label}-${index}`}>
                    <p className="text-text-primary">{row.label}</p>
                    <p className="whitespace-pre-line break-words text-text-secondary">{row.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {context.length ? (
            <section>
              <h4 className={HEADING}>Company context</h4>
              <ul className="space-y-1">
                {context.map((source, index) => (
                  <li key={`${source}-${index}`} className="break-words text-text-secondary">
                    {/^https:\/\//i.test(source) ? <a href={source} target="_blank" rel="noreferrer" className="text-primary hover:underline">{source}</a> : source}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
