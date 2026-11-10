'use client';

import { useState, type ReactNode } from 'react';
import type { AnswerEvidence, EvidenceImage, EvidenceSource } from '@/lib/ai/evidence';
import { sameUrl } from '@/lib/ai/evidenceUrl';

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
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export interface AnswerStep {
  name: string;
  detail?: string;
  model?: string;
  cost: string;
  warning?: boolean;
}

/** What a step did, from the record it left behind, in plain words. */
function nameStep(stage: AnswerStage): Pick<AnswerStep, 'name' | 'detail' | 'warning'> {
  const note = (stage.note ?? '').trim();
  const plainNote = note ? sentence(note) : undefined;
  switch (stage.stage) {
    case 'plan':
      if (/^unusable plan|^failed/i.test(note)) return { name: 'Tried to plan the approach', detail: 'That attempt was unusable, so it tried again.' };
      return { name: 'Planned the approach', detail: plainNote };
    case 'research': {
      const scout = /^Scout sources:\s*([\s\S]*)$/i.exec(note);
      if (scout) return { name: 'Looked for likely sources', detail: clip(sentence(scout[1]!.replace(/^[a-z_]+:\s*/, '')), 140) };
      const followUp = /^Follow-up:\s*([\s\S]*)$/i.exec(note);
      if (followUp) return { name: 'Followed up on a gap', detail: clip(followUp[1]!, 200) };
      const tools = /^tools:\s*(.*)$/i.exec(note);
      if (tools) return { name: 'Researched', detail: `Used ${tools[1]!.replace(/_/g, ' ')}` };
      return { name: 'Researched', detail: note ? clip(sentence(note), 200) : undefined, warning: /^skipped|could not/i.test(note) };
    }
    case 'gaps':
      return { name: 'Checked what was still missing', detail: note ? clip(sentence(note), 200) : undefined };
    case 'work':
      return { name: 'Wrote the answer', detail: plainNote };
    case 'review': {
      const revised = /^revise:?\s*([\s\S]*)$/i.exec(note);
      if (revised) return { name: 'Reviewed and corrected the answer', detail: revised[1] ? clip(sentence(revised[1]), 240) : undefined };
      const accepted = /^accept:?\s*([\s\S]*)$/i.exec(note);
      if (accepted) return { name: 'Reviewed the answer', detail: accepted[1] ? clip(sentence(accepted[1]), 240) : undefined };
      return { name: 'Reviewed the answer', detail: plainNote };
    }
    case 'job':
      return { name: 'Prepared a responsibility', detail: plainNote };
    case 'code':
      return { name: 'Planned a code change', detail: plainNote };
    default:
      return { name: sentence(stage.stage), detail: plainNote };
  }
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
    if (stage.stage === 'verify' || stage.stage === 'size') {
      return [{ name: stage.stage === 'size' ? 'Looked up site sizes' : 'Opened the pages itself', detail: stage.note, cost: 'No model' }];
    }
    if (stage.stage === 'check') {
      const passed = Boolean(stage.note?.startsWith('all'));
      return [{ name: passed ? 'Checked the numbers' : 'Numbers need a look', detail: stage.note ? sentence(stage.note) : undefined, cost: 'No model', warning: !passed }];
    }
    const cost = stage.free ? 'Free' : stage.costMicros != null ? formatCost(stage.costMicros) : stage.model ? 'Unknown' : '';
    return [{ warning: false, ...nameStep(stage), model: modelName(stage.model) || undefined, cost }];
  });
}

/** One website the answer relied on, however many of its pages it links to. */
export interface EvidenceSite {
  host: string;
  pages: EvidenceSource[];
  usedFor: string[];
  found: string[];
  images: EvidenceImage[];
}

export interface OrganizedEvidence {
  /** Pages the answer links to. */
  used: EvidenceSource[];
  /** The same pages, gathered by website. */
  sites: EvidenceSite[];
  /** Pages the research named that do not exist. */
  gone: EvidenceSource[];
  /** Pages a worker opened that the answer does not link to. */
  read: EvidenceSource[];
  /** Pages that only came up in search results. */
  seen: EvidenceSource[];
  imagesFor: (source: EvidenceSource) => EvidenceImage[];
  /** Images whose page is not one of the sources. */
  otherImages: EvidenceImage[];
}

export function organizeEvidence(evidence?: AnswerEvidence | null): OrganizedEvidence {
  const sources = evidence?.sources ?? [];
  const images = evidence?.images ?? [];
  const known = new Set(sources.map((source) => sameUrl(source.url)));
  const used = sources.filter((source) => source.cited);
  const imagesFor = (source: EvidenceSource) => images.filter((image) => image.pageUrl && sameUrl(image.pageUrl) === sameUrl(source.url));
  const sites = new Map<string, EvidenceSite>();
  for (const page of used) {
    const host = hostOf(page.url);
    const site = sites.get(host) ?? { host, pages: [], usedFor: [], found: [], images: [] };
    sites.set(host, site);
    site.pages.push(page);
    site.images.push(...imagesFor(page));
    for (const item of page.usedFor ?? []) if (!site.usedFor.includes(item)) site.usedFor.push(item);
    for (const item of page.found ?? []) if (!site.found.includes(item) && !site.usedFor.includes(item)) site.found.push(item);
  }
  return {
    used,
    sites: [...sites.values()],
    gone: sources.filter((source) => !source.cited && source.gone),
    read: sources.filter((source) => !source.cited && source.read),
    seen: sources.filter((source) => !source.cited && !source.read && !source.gone),
    imagesFor,
    otherImages: images.filter((image) => !image.pageUrl || !known.has(sameUrl(image.pageUrl))),
  };
}

export function detailsSummary(input: { evidence?: AnswerEvidence | null; steps: AnswerStep[]; costMicros?: number | null }): string {
  const { sites, read } = organizeEvidence(input.evidence);
  const images = input.evidence?.images.length ?? 0;
  const data = input.evidence?.data.length ?? 0;
  return [
    sites.length ? `${plural(sites.length, 'site')} used` : '',
    read.length ? `${plural(read.length, 'more page')} read` : '',
    images ? plural(images, 'image') : '',
    data ? plural(data, 'data lookup') : '',
    input.steps.length ? plural(input.steps.length, 'step') : '',
    input.costMicros != null ? formatCost(input.costMicros) : '',
  ].filter(Boolean).join(' · ');
}

const HEADING = 'mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary';
const LABEL = 'mt-1.5 text-[10px] font-medium text-text-secondary';

function ImageTile({ image, caption }: { image: EvidenceImage; caption?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <li className="min-w-0">
      <a href={image.pageUrl ?? image.imageUrl} target="_blank" rel="noreferrer" title={image.title} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- pictures from other sites, shown as found */}
        <img src={image.imageUrl} alt={image.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-20 w-full rounded border border-border object-cover" />
        {caption ? <span className="mt-0.5 block truncate text-[10px] text-text-secondary">{caption}</span> : null}
      </a>
    </li>
  );
}

function Statements({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      <p className={LABEL}>{label}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-text-primary">
        {items.map((item) => <li key={item} className="break-words">{item}</li>)}
      </ul>
    </>
  );
}

/** One website: its pages with whether each was really opened, what was taken from them, and their pictures. */
function SiteCard({ site }: { site: EvidenceSite }) {
  return (
    <li className="min-w-0 rounded-md border border-border p-2">
      <p className="font-semibold text-text-primary">{site.host}</p>
      <ul className="mt-1 space-y-0.5">
        {site.pages.map((page) => (
          <li key={page.url} className="break-words">
            <a href={page.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{page.title}</a>
            {page.read ? <span className="text-text-secondary"> · Opened</span> : page.blocked ? <span className="text-amber-400"> · Could not be read</span> : page.usedFor ? <span className="text-amber-400"> · Not opened</span> : null}
          </li>
        ))}
      </ul>
      <Statements label="Used in the answer for" items={site.usedFor} />
      <Statements label="Noted during research" items={site.found} />
      {site.images.length ? (
        <>
          <p className={LABEL}>{plural(site.images.length, 'image')} from this site</p>
          <ul className="mt-1 grid grid-cols-3 gap-1.5">
            {site.images.map((image) => <ImageTile key={image.imageUrl} image={image} caption={site.pages.some((page) => page.title === image.title) ? undefined : image.title} />)}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/** One page: what it is, whether it was really opened, what was taken from it, and the pictures found on it. */
function SourceCard({ source, images }: { source: EvidenceSource; images: EvidenceImage[] }) {
  return (
    <li className="min-w-0 rounded-md border border-border p-2">
      <a href={source.url} target="_blank" rel="noreferrer" className="break-words text-primary hover:underline">{source.title}</a>
      <p className="text-[10px] text-text-secondary">
        {hostOf(source.url)}
        {source.read ? ' · Page opened' : null}
      </p>
      <Statements label="Used in the answer for" items={source.usedFor} />
      <Statements label="Noted during research" items={source.found?.filter((item) => !source.usedFor?.includes(item))} />
      {!source.usedFor?.length && !source.found?.length && source.snippet ? <p className="mt-1 break-words text-text-secondary">{source.snippet}</p> : null}
      {images.length ? (
        <>
          <p className={LABEL}>{plural(images.length, 'image')} from this page</p>
          <ul className="mt-1 grid grid-cols-3 gap-1.5">
            {images.map((image) => <ImageTile key={image.imageUrl} image={image} caption={image.title === source.title ? undefined : image.title} />)}
          </ul>
        </>
      ) : null}
    </li>
  );
}

function Collapsed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/**
 * What an answer is based on and how it was made, one click away. Organized by page, so each fact and picture sits
 * under the page it came from. Closed, nothing below loads, so reading an answer contacts no other site. Pages and
 * images come from the web, so they are only ever shown as text and links.
 */
export default function AnswerDetails({ stages, evidence, contextSources, costMicros, defaultOpen = false }: { stages?: AnswerStage[]; evidence?: AnswerEvidence | null; contextSources?: string[]; costMicros?: number | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = describeStages(stages ?? []);
  const { used, sites, gone, read, seen, imagesFor, otherImages } = organizeEvidence(evidence);
  const data = evidence?.data ?? [];
  const context = contextSources ?? [];
  const summary = detailsSummary({ evidence, steps, costMicros });
  if (!summary && !context.length) return null;
  // Only a cost to report: say it, with no button that would open onto nothing.
  if (!steps.length && !used.length && !read.length && !seen.length && !otherImages.length && !data.length && !context.length) return <p className="mt-2 border-t border-border pt-1.5 text-[11px] text-text-secondary">{summary}</p>;
  return (
    <div className="mt-2 border-t border-border pt-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left text-[11px] text-text-secondary hover:text-text-primary">
        <span className="min-w-0 truncate">{summary || 'Company context'}</span>
        <span className="shrink-0">{open ? 'Hide details' : 'Show details'}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-4 text-[11px]">
          {used.length ? (
            <section>
              <h4 className={HEADING}>Where this answer came from · {plural(sites.length, 'site')}</h4>
              <ul className="space-y-2">{sites.map((site) => <SiteCard key={site.host} site={site} />)}</ul>
            </section>
          ) : null}
          {data.length ? (
            <section>
              <h4 className={HEADING}>Data used · {data.length}</h4>
              <ul className="space-y-2">
                {data.map((row, index) => (
                  <li key={`${row.label}-${index}`} className="rounded-md border border-border p-2">
                    <p className="text-text-primary">{row.label}</p>
                    <p className="whitespace-pre-line break-words text-text-secondary">{row.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
          {read.length ? (
            <Collapsed title={`Also read, not used in the answer · ${read.length}`}>
              <ul className="space-y-2">{read.map((source) => <SourceCard key={source.url} source={source} images={imagesFor(source)} />)}</ul>
            </Collapsed>
          ) : null}
          {gone.length ? (
            <Collapsed title={`Named in research, but the page does not exist · ${gone.length}`}>
              <ul className="space-y-1">{gone.map((source) => <li key={source.url} className="min-w-0 break-words text-text-secondary">{source.url}</li>)}</ul>
            </Collapsed>
          ) : null}
          {seen.length ? (
            <Collapsed title={`Came up in search, never opened · ${seen.length}`}>
              <ul className="space-y-1">
                {seen.map((source) => (
                  <li key={source.url} className="min-w-0 break-words">
                    <a href={source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{source.title}</a>
                    <span className="text-text-secondary"> · {hostOf(source.url)}</span>
                  </li>
                ))}
              </ul>
            </Collapsed>
          ) : null}
          {otherImages.length ? (
            <Collapsed title={`Other images · ${otherImages.length}`}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{otherImages.map((image) => <ImageTile key={image.imageUrl} image={image} caption={image.title} />)}</ul>
            </Collapsed>
          ) : null}
          {context.length ? (
            <Collapsed title={`Company context it could see · ${context.length}`}>
              <ul className="space-y-1">
                {context.map((source, index) => (
                  <li key={`${source}-${index}`} className="break-words text-text-secondary">
                    {/^https:\/\//i.test(source) ? <a href={source} target="_blank" rel="noreferrer" className="text-primary hover:underline">{source}</a> : source}
                  </li>
                ))}
              </ul>
            </Collapsed>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
