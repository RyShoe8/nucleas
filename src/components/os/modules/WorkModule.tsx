'use client';
import AppSections from './AppSections';
import dynamic from 'next/dynamic';
const JobsModule = dynamic(() => import('./JobsModule'));
const BuildingModule = dynamic(() => import('./BuildingModule'));
const ToolsModule = dynamic(() => import('./ToolsModule'));
export default function WorkModule() {
    return <AppSections title="Review & work" sections={[
        { id: 'jobs', label: 'Responsibilities', render: () => <JobsModule /> },
        { id: 'building', label: 'Build', render: () => <BuildingModule /> },
        { id: 'tools', label: 'Tools', render: () => <ToolsModule /> },
    ]} />;
}
