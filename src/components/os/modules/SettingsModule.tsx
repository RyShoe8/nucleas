'use client';
import AppSections from './AppSections';
import dynamic from 'next/dynamic';
const AiRoutingModule = dynamic(() => import('./AiRoutingModule'));
const AiBudgetsModule = dynamic(() => import('./AiBudgetsModule'));
const AiSpendModule = dynamic(() => import('./AiSpendModule'));
export default function SettingsModule() {
    return <AppSections title="Settings" sections={[
        { id: 'engine', label: 'AI Engine', render: () => <AiRoutingModule /> },
        { id: 'budgets', label: 'Budgets', render: () => <AiBudgetsModule /> },
        { id: 'spend', label: 'Spend', render: () => <AiSpendModule /> },
    ]} />;
}
