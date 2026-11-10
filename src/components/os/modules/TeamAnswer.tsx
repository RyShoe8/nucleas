'use client';
import { useEffect, useState } from 'react';
import type { AnswerEvidence } from '@/lib/ai/evidence';
import AnswerDetails from './assistant/AnswerDetails';
import AnswerPresentation from './assistant/AnswerPresentation';

/** One question put to a company's team from its Team screen, and the answer as it forms. */
export interface TeamQuestion {
  id: string;
  question: string;
  status: 'working' | 'done' | 'failed';
  startedAt: number;
  /** What the team is doing, newest last. */
  progress: string[];
  text?: string;
  error?: string;
  stages?: { stage: string; model?: string; free?: boolean; costMicros?: number | null; note?: string }[];
  evidence?: AnswerEvidence | null;
  contextSources?: string[];
  costMicros?: number | null;
}

type Reply = Pick<TeamQuestion, 'text' | 'stages' | 'evidence' | 'contextSources' | 'costMicros'> & { role?: string };

/** Asks the team through the same engine as Ask, focused on one company, reporting each step as it happens. */
export async function askTeam(companyId: string, question: string, onProgress: (text: string) => void): Promise<{ reply?: Reply; error?: string }> {
  const res = await fetch('/api/os/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ text: question, focusCompanyId: companyId, mode: 'orchestrated' }),
  });
  if (!(res.headers.get('content-type') ?? '').includes('ndjson') || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { turn?: Reply; error?: string };
    return res.ok && body.turn ? { reply: body.turn } : { error: body.error ?? `The team could not answer (${res.status}).` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { reply?: Reply; error?: string } = { error: 'The answer stopped before it finished. Ask again.' };
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as { type: string; text?: string; error?: string; turn?: Reply };
      if (event.type === 'progress' && event.text) onProgress(event.text);
      else if (event.type === 'reply' && event.turn) result = { reply: event.turn };
      else if (event.type === 'error') result = { error: event.error ?? 'The team could not answer.' };
    } catch { /* A malformed line is skipped. */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) { handle(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); newline = buffer.indexOf('\n'); }
  }
  handle(buffer);
  return result;
}

/** The single action the answer recommends, so it can be handed to the team as work. */
export function recommendedAction(answer: string): string | null {
  const match = /\*\*Recommendation:?\*\*:?\s*([\s\S]*?)(?:\n\s*\n|\n\*\*|$)/i.exec(answer);
  const text = match?.[1]?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return text && text.length >= 12 ? text : null;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>;
}

export default function TeamAnswer({ item, companyName, canManage, onHandOff, onFollowUp, onDismiss }: { item: TeamQuestion; companyName: string; canManage: boolean; onHandOff: (task: string) => void; onFollowUp: () => void; onDismiss: () => void }) {
  const action = item.text ? recommendedAction(item.text) : null;
  return <article className="rounded-2xl border border-border overflow-hidden">
    <header className="flex items-start justify-between gap-3 border-b border-border bg-background-card/40 px-4 py-3">
      <div className="min-w-0"><p className="text-[11px] uppercase tracking-wider text-text-secondary">You asked {companyName}&rsquo;s team</p><p className="mt-0.5 text-sm font-medium">{item.question}</p></div>
      <button type="button" className="shrink-0 text-xs text-text-secondary underline" onClick={onDismiss}>{item.status === 'working' ? 'Hide' : 'Close'}</button>
    </header>

    {item.status === 'working' && <div className="px-4 py-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" aria-hidden />{item.progress.at(-1) ?? 'Reading the question'} <span className="text-xs text-text-secondary">· <Elapsed since={item.startedAt} /></span></p>
      {item.progress.length > 1 && <ol className="mt-2 space-y-1 border-l border-border pl-3 text-xs text-text-secondary">{item.progress.slice(0, -1).map((line, index) => <li key={index}>{line}</li>)}</ol>}
      <p className="mt-2 text-xs text-text-secondary">Members are being brought in and their interns are searching the web first, so this can take a few minutes. You can keep working; the answer stays here.</p>
    </div>}

    {item.status === 'failed' && <p role="alert" className="px-4 py-3 text-sm text-amber-300">{item.error}</p>}

    {item.status === 'done' && item.text && <div className="px-4 py-3">
      <AnswerPresentation text={item.text} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canManage && action ? <button type="button" className="ui-button-primary" onClick={() => onHandOff(action)}>Hand this to the team</button> : null}
        <button type="button" className="ui-button" onClick={onFollowUp}>Ask a follow-up</button>
        {canManage && action ? <span className="text-xs text-text-secondary">Puts the recommendation in the box above for you to edit before handing it off.</span> : null}
      </div>
      {/* The depth, one click away: who was asked and what they said, what their interns read, the company figures used, and the cost. */}
      <AnswerDetails stages={item.stages} evidence={item.evidence} contextSources={item.contextSources} costMicros={item.costMicros} />
    </div>}
  </article>;
}
