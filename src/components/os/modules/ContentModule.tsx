'use client';

import { useState } from 'react';
import JobsModule from './JobsModule';
import WatchesPanel from './content/WatchesPanel';
import ArticlesPanel from './content/ArticlesPanel';

type Tab = 'articles' | 'watches' | 'jobs';

const TABS: { id: Tab; label: string }[] = [
    { id: 'articles', label: 'Articles' },
    { id: 'watches', label: 'Watches' },
    { id: 'jobs', label: 'Jobs' },
];

/** Content: articles written in a company's Voice, mailbox watches for the emails worth acting on, and the content jobs Nucleas runs. */
export default function ContentModule({ initialTab }: { initialTab?: string }) {
    const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : 'articles');
    return (
        <div className="touch-comfort flex h-full flex-col text-text-primary">
            <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist" aria-label="Content">
                {TABS.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'ui-button-primary' : 'ui-button'} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'articles' ? <ArticlesPanel /> : tab === 'watches' ? <WatchesPanel /> : <JobsModule categories={['content']} title="Content" />}</div>
        </div>
    );
}
