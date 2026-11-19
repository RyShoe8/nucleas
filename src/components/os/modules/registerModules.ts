import { createElement } from 'react';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import type { ModuleDefinition } from '@/lib/os/types';
import dynamic from 'next/dynamic';
const OfficeModule = dynamic(() => import('./OfficeModule'));
const TeamModule = dynamic(() => import('./TeamModule'));
const WorkModule = dynamic(() => import('./WorkModule'));
const GrowthModule = dynamic(() => import('./GrowthModule'));
const SettingsModule = dynamic(() => import('./SettingsModule'));
const VoiceModule = dynamic(() => import('./VoiceModule'));
const CompaniesModule = dynamic(() => import('./CompaniesModule'));
const CompanyModule = dynamic(() => import('./CompanyModule'));
const TodayModule = dynamic(() => import('./TodayModule'));
const IntegrationsModule = dynamic(() => import('./IntegrationsModule'));
const AssistantModule = dynamic(() => import('./AssistantModule'));
const AiSpendModule = dynamic(() => import('./AiSpendModule'));
const AiBudgetsModule = dynamic(() => import('./AiBudgetsModule'));
const AiRoutingModule = dynamic(() => import('./AiRoutingModule'));
const BuildingModule = dynamic(() => import('./BuildingModule'));
const JobsModule = dynamic(() => import('./JobsModule'));
const ToolsModule = dynamic(() => import('./ToolsModule'));
const MailModule = dynamic(() => import('./MailModule'));
const BrandVoiceModule = dynamic(() => import('./BrandVoiceModule'));
const ContentModule = dynamic(() => import('./ContentModule'));

let registered = false;

/**
 * Register all Phase 1 OS modules. Safe to call multiple times.
 */
export function registerOsModules(): void {
    if (registered) return;
    registered = true;

    const baseMin = { width: 320, height: 220 };

    const definitions: ModuleDefinition[] = [
        {
            id: 'office',
            title: 'Office',
            icon: '⌂',
            defaultSize: { width: 1180, height: 820 },
            minSize: { width: 420, height: 360 },
            canPopout: true,
            permissions: 'member',
            render: () => createElement(OfficeModule),
        },
        {
            id: 'team',
            title: 'Team',
            icon: '◈',
            defaultSize: { width: 1040, height: 760 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'member',
            render: (ctx) => createElement(TeamModule, ctx),
        },
        {
            id: 'work',
            title: 'Review & work',
            icon: '▤',
            defaultSize: { width: 1000, height: 720 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'member',
            render: () => createElement(WorkModule),
        },
        {
            id: 'growth',
            title: 'Growth',
            icon: '↗',
            defaultSize: { width: 1000, height: 720 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () => createElement(GrowthModule),
        },
        {
            id: 'settings',
            title: 'Settings',
            icon: '⚙',
            defaultSize: { width: 900, height: 700 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'admin',
            render: () => createElement(SettingsModule),
        },
        {
            id: 'today',
            title: 'Today',
            icon: '☀️',
            defaultSize: { width: 980, height: 560 },
            minSize: { width: 520, height: 320 },
            canPopout: true,
            permissions: 'member',
            render: () => createElement(TodayModule),
        },
        {
            id: 'companies',
            title: 'Companies',
            icon: '🏢',
            defaultSize: { width: 560, height: 520 },
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () => createElement(CompaniesModule),
        },
        {
            id: 'company',
            title: 'Company',
            icon: '🏢',
            defaultSize: { width: 1040, height: 760 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            windowTitle: (payload) => payload?.companyName,
            render: (ctx) => createElement(CompanyModule, ctx),
        },
        {
            id: 'assistant',
            title: 'Ask Nucleas',
            icon: '✨',
            defaultSize: { width: 640, height: 640 },
            minSize: { width: 400, height: 360 },
            canPopout: true,
            permissions: 'member',
            render: (ctx) => createElement(AssistantModule, { payload: ctx.payload }),
        },
        {
            id: 'ai-budgets',
            title: 'AI Budgets',
            icon: '$',
            defaultSize: { width: 560, height: 580 },
            minSize: { width: 360, height: 320 },
            canPopout: true,
            permissions: 'admin',
            launcherHidden: true,
            render: () => createElement(AiBudgetsModule),
        },
        {
            id: 'ai-spend',
            title: 'AI Spend',
            icon: '💸',
            defaultSize: { width: 820, height: 640 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'admin',
            launcherHidden: true,
            render: () => createElement(AiSpendModule),
        },
        {
            id: 'ai-routing',
            title: 'AI Engine',
            icon: '🧭',
            defaultSize: { width: 820, height: 640 },
            minSize: { width: 520, height: 360 },
            canPopout: true,
            permissions: 'admin',
            launcherHidden: true,
            render: () => createElement(AiRoutingModule),
        },
        {
            id: 'building',
            title: 'Building',
            icon: '🏗️',
            defaultSize: { width: 1040, height: 760 },
            minSize: { width: 440, height: 320 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () => createElement(BuildingModule),
        },
        {
            id: 'mail',
            title: 'Mail',
            icon: '✉️',
            defaultSize: { width: 1120, height: 720 },
            minSize: { width: 640, height: 400 },
            canPopout: true,
            permissions: 'manager',
            render: () => createElement(MailModule),
        },
        {
            id: 'brand-voice',
            title: 'Voice',
            icon: '🗣️',
            defaultSize: { width: 760, height: 660 },
            minSize: { width: 460, height: 360 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            windowTitle: (payload) => (payload?.companyName ? `${payload.companyName} · Voice` : undefined),
            render: (ctx) => createElement(BrandVoiceModule, ctx),
        },
        {
            id: 'jobs',
            title: 'All responsibilities',
            icon: '🗂️',
            defaultSize: { width: 800, height: 660 },
            minSize: { width: 460, height: 320 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () => createElement(JobsModule),
        },
        {
            id: 'marketing',
            title: 'Marketing',
            icon: '📣',
            defaultSize: { width: 800, height: 660 },
            minSize: { width: 460, height: 320 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: (ctx) => createElement(JobsModule, { categories: ['marketing', 'outreach'], title: 'Marketing', initialCompanyId: ctx.payload?.companyId, initialKind: ctx.payload?.kind, initialView: ctx.payload?.view, initialWatchId: ctx.payload?.watchId, initialWatchBrief: ctx.payload?.watchBrief }),
        },
        {
            id: 'content',
            title: 'Content',
            icon: '✍️',
            defaultSize: { width: 800, height: 660 },
            minSize: { width: 460, height: 320 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: (ctx) => createElement(ContentModule, { initialTab: ctx.payload?.tab, initialCompanyId: ctx.payload?.companyId }),
        },
        {
            id: 'tools',
            title: 'Tools',
            icon: '🧰',
            defaultSize: { width: 680, height: 640 },
            minSize: { width: 440, height: 420 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () => createElement(ToolsModule),
        },
        {
            id: 'integrations',
            title: 'Integrations',
            icon: '🔌',
            defaultSize: { width: 720, height: 560 },
            minSize: { width: 480, height: 320 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            windowTitle: (payload) => (payload?.companyName ? `${payload.companyName} · Integrations` : undefined),
            render: (ctx) => createElement(IntegrationsModule, ctx),
        },
        {
            id: 'voice',
            title: 'Voice',
            icon: '🎙️',
            defaultSize: { width: 420, height: 360 },
            minSize: baseMin,
            canPopout: false,
            permissions: 'member',
            launcherHidden: true,
            render: () => createElement(VoiceModule),
        },
    ];

    definitions.forEach((d) => ModuleRegistry.register(d));
}
