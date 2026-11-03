'use client';
import AppSections from './AppSections';
import dynamic from 'next/dynamic';
const JobsModule = dynamic(() => import('./JobsModule'));
const ContentModule = dynamic(() => import('./ContentModule'));
export default function GrowthModule() {
    return <AppSections title="Growth" sections={[
        { id: 'marketing', label: 'Marketing', render: () => <JobsModule categories={['marketing', 'outreach']} title="Marketing" /> },
        { id: 'content', label: 'Content', render: () => <ContentModule /> },
    ]} />;
}
