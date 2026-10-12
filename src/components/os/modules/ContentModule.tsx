'use client';

import { useState } from 'react';
import JobsModule from './JobsModule';
import WatchesPanel from './content/WatchesPanel';

type Tab = 'watches' | 'jobs';

/** Content: watch mailboxes for the emails worth acting on, and the content jobs Nucleas runs. */
export default function ContentModule() {
    const [tab, setTab] = useState<Tab>('watches');
    return (
        <div className="flex h-full flex-col text-text-primary">
            <div className="flex gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="Content">
                <button type="button" role="tab" aria-selected={tab === 'watches'} className={tab === 'watches' ? 'ui-button-primary' : 'ui-button'} onClick={() => setTab('watches')}>Watches</button>
                <button type="button" role="tab" aria-selected={tab === 'jobs'} className={tab === 'jobs' ? 'ui-button-primary' : 'ui-button'} onClick={() => setTab('jobs')}>Jobs</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'watches' ? <WatchesPanel /> : <JobsModule categories={['content']} title="Content" />}</div>
        </div>
    );
}
