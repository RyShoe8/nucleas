'use client';
import { Activity, useState, type ReactNode } from 'react';
/** Keep visited tabs mounted so drafts and filters survive navigation within an app. */
export default function AppSections({ title, sections }: { title: string; sections: { id: string; label: string; render: () => ReactNode }[] }) {
    const [selected, setSelected] = useState(sections[0].id);
    const [visited, setVisited] = useState<string[]>([sections[0].id]);
    return <section className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-5 border-b border-border px-5 py-3"><h1 className="text-base font-semibold">{title}</h1><div className="flex gap-1" role="tablist" aria-label={title}>
            {sections.map(section => <button key={section.id} role="tab" id={`${title}-${section.id}`} aria-controls={`${title}-panel-${section.id}`} aria-selected={selected === section.id} className={`rounded-lg px-3 py-2 text-sm ${selected === section.id ? 'bg-background-elevated text-primary' : 'text-text-secondary'}`} onClick={() => { setSelected(section.id); setVisited(previous => previous.includes(section.id) ? previous : [...previous, section.id]); }}>{section.label}</button>)}
        </div></header>
        {sections.filter(section => visited.includes(section.id)).map(section => <Activity key={section.id} mode={selected === section.id ? 'visible' : 'hidden'}><div id={`${title}-panel-${section.id}`} role="tabpanel" aria-labelledby={`${title}-${section.id}`} hidden={selected !== section.id} className="min-h-0 flex-1 overflow-auto">{section.render()}</div></Activity>)}
    </section>;
}
