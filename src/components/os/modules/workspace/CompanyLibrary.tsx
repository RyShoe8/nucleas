'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import RetainedSection from './RetainedSection';
const About = dynamic(() => import('../CompanyAbout'));
const Records = dynamic(() => import('./LibraryRecords'));
const MarketingPlan = dynamic(() => import('../jobs/MarketingPlanEditor'));
const Voice = dynamic(() => import('../BrandVoiceModule'));
const Content = dynamic(() => import('../ContentModule'));
export default function CompanyLibrary({ companyId, companyName }: { companyId: string; companyName: string }) {
    const [view, setView] = useState('plan');
    return <section className="space-y-4"><div><h2 className="text-lg font-semibold">Library</h2><p className="text-sm text-text-secondary">The approved strategy, voice, and content your team works from.</p></div>
        <div className="flex flex-wrap gap-2">{[['plan', 'Marketing overview'], ['voice', 'Brand voice'], ['content', 'Content'], ['about', 'Company knowledge'], ['assets', 'Assets'], ['research', 'Research'], ['decisions', 'Decisions']].map(([key, label]) => <button key={key} aria-pressed={view === key} className={view === key ? 'ui-button-primary' : 'ui-button'} onClick={() => setView(key)}>{label}</button>)}</div>
        <RetainedSection active={view === 'plan'}><MarketingPlan companyId={companyId} /></RetainedSection>
        <RetainedSection active={view === 'voice'}><Voice windowId={`library-${companyId}`} moduleId="brand-voice" payload={{ companyId, companyName }} /></RetainedSection>
        <RetainedSection active={view === 'content'}><Content initialCompanyId={companyId} /></RetainedSection>
        <RetainedSection active={view === 'about'}><About companyId={companyId} companyName={companyName} /></RetainedSection>
        <RetainedSection active={['assets', 'research', 'decisions'].includes(view)}><Records key={companyId} companyId={companyId} view={view} /></RetainedSection>
    </section>;
}
