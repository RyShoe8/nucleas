import { createElement } from 'react';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import type { ModuleDefinition } from '@/lib/os/types';
import ProjectsModule from './ProjectsModule';
import ProjectDetailModule from './ProjectDetailModule';
import AgendaModule from './AgendaModule';
import ScheduleModule from './ScheduleModule';
import VoiceModule from './VoiceModule';
import PlaceholderModule from './PlaceholderModule';
import CompaniesModule from './CompaniesModule';
import CompanyModule from './CompanyModule';
import TodayModule from './TodayModule';
import IntegrationsModule from './IntegrationsModule';
import AssistantModule from './AssistantModule';
import AiSpendModule from './AiSpendModule';
import AiRoutingModule from './AiRoutingModule';

let registered = false;

/**
 * Register all Phase 1 OS modules. Safe to call multiple times.
 */
export function registerOsModules(): void {
    if (registered) return;
    registered = true;

    const baseSize = { width: 520, height: 400 };
    const baseMin = { width: 320, height: 220 };
    const scheduleSize = { width: 1000, height: 700 };
    const agendaSize = { width: 960, height: 640 };

    const definitions: ModuleDefinition[] = [
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
            defaultSize: { width: 760, height: 640 },
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
            render: () => createElement(AssistantModule),
        },
        {
            id: 'ai-spend',
            title: 'AI Spend',
            icon: '💸',
            defaultSize: { width: 820, height: 640 },
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'admin',
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
            render: () => createElement(AiRoutingModule),
        },
        {
            id: 'integrations',
            title: 'Integrations',
            icon: '🔌',
            defaultSize: { width: 720, height: 560 },
            minSize: { width: 480, height: 320 },
            canPopout: true,
            permissions: 'member',
            windowTitle: (payload) => (payload?.companyName ? `${payload.companyName} · Integrations` : undefined),
            render: (ctx) => createElement(IntegrationsModule, ctx),
        },
        {
            id: 'projects',
            title: 'Projects',
            icon: '📁',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () => createElement(ProjectsModule),
        },
        {
            id: 'agenda',
            title: 'Agenda',
            icon: '📋',
            defaultSize: agendaSize,
            minSize: { width: 480, height: 360 },
            canPopout: true,
            permissions: 'member',
            render: () => createElement(AgendaModule),
        },
        {
            id: 'schedule',
            title: 'Schedule',
            icon: '📅',
            defaultSize: scheduleSize,
            minSize: { width: 640, height: 400 },
            canPopout: true,
            permissions: 'member',
            render: () => createElement(ScheduleModule),
        },
        {
            id: 'project-detail',
            title: 'Project',
            icon: '📋',
            defaultSize: { width: 1350, height: 700 },
            minSize: { width: 720, height: 360 },
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            windowTitle: (payload) => payload?.projectName,
            render: (ctx) => createElement(ProjectDetailModule, ctx),
        },
        {
            id: 'tasks',
            title: 'Tasks',
            icon: '✅',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Tasks',
                    description: 'Cross-project task list will live here.',
                }),
        },
        {
            id: 'content',
            title: 'Content',
            icon: '📝',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Content',
                    description: 'Content calendar and channel filters.',
                }),
        },
        {
            id: 'assets',
            title: 'Assets',
            icon: '🗂️',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Assets',
                    description: 'Screenshots, files, and links attached to work.',
                }),
        },
        {
            id: 'search',
            title: 'Search',
            icon: '🔎',
            defaultSize: { width: 480, height: 320 },
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            launcherHidden: true,
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Search',
                    description: 'Global search across projects, tasks, content, and assets.',
                }),
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
        {
            id: 'activity',
            title: 'Activity',
            icon: '📈',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Activity',
                    description: 'Recent actions across your workspace.',
                }),
        },
        {
            id: 'smart-buttons',
            title: 'Smart Buttons',
            icon: '⚡',
            defaultSize: baseSize,
            minSize: baseMin,
            canPopout: true,
            permissions: 'member',
            render: () =>
                createElement(PlaceholderModule, {
                    title: 'Smart Buttons',
                    description: 'Quick-action surfaces and partner shortcuts.',
                }),
        },
    ];

    definitions.forEach((d) => ModuleRegistry.register(d));
}
