'use client';

import { useState } from 'react';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';
import { parseAnswerSlides } from '@/lib/ai/answerSlides';

export default function AnswerPresentation({ text }: { text: string }) {
    const slides = parseAnswerSlides(text);
    const [index, setIndex] = useState(0);
    const [showText, setShowText] = useState(false);
    const plain = text.replace('<!-- nucleas-slides -->', '').trim();
    if (!slides) return <IdeChatMarkdown text={plain} />;
    const current = Math.min(index, slides.length - 1);
    const slide = slides[current];
    return <section aria-label="Sourced briefing" className="w-full min-w-0 sm:min-w-[360px] sm:max-w-2xl">
        <div className="mb-3 flex items-center justify-between gap-4">
            <span className="text-[10px] uppercase tracking-[0.2em] text-text-secondary">Nucleas briefing</span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowText(v => !v)}>{showText ? 'View slides' : 'Read full text'}</button>
        </div>
        {showText ? <IdeChatMarkdown text={plain} /> : <>
            <div className="rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-500/10 via-background to-background p-5 sm:p-7" aria-live="polite" aria-atomic="true">
                <span className="text-xs tabular-nums text-violet-300">{String(current + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
                <h3 className="mt-4 mb-5 text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">{slide.title}</h3>
                <IdeChatMarkdown text={slide.body} />
            </div>
            <nav aria-label="Briefing slides" className="mt-3 flex items-center justify-between gap-3">
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40" disabled={current === 0} onClick={() => setIndex(current - 1)}>← Previous</button>
                <div className="flex gap-1">{slides.map((s, i) => <button type="button" key={i} aria-label={s.title} aria-current={i === current ? 'step' : undefined} onClick={() => setIndex(i)} className="p-2"><span className={`block h-1.5 w-1.5 rounded-full ${i === current ? 'bg-violet-300' : 'bg-text-muted'}`} /></button>)}</div>
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40" disabled={current === slides.length - 1} onClick={() => setIndex(current + 1)}>Next →</button>
            </nav>
        </>}
    </section>;
}
