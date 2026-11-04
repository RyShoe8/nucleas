'use client';

import { useCallback, useState } from 'react';
import CalendarView from '@/components/planning-map/CalendarView';
import AgendaView from '@/components/workspace/AgendaView';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useOsScheduleData } from '@/hooks/os/useOsScheduleData';
import useWorkspaceMeetings from '@/lib/hooks/useWorkspaceMeetings';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { IProject } from '@/lib/models/Project';
import { TimeframeType } from '@/lib/utils/dateUtils';
import { getTaskAssigneeEmployeeIds } from '@/lib/utils/projectTeam';

export default function AgendaModule() {
    const wm = useWindowManager();
    const auth = useOsAuth();
    const [timeframe, setTimeframe] = useState<TimeframeType>('weekly');
    const [currentDate, setCurrentDate] = useState(() => new Date());

    const { projects, contentItems, employees, loading, error, currentUserEmployeeName, refresh } =
        useOsScheduleData(timeframe, currentDate);
    const { meetings } = useWorkspaceMeetings(timeframe, currentDate, true, 0);

    const openProject = useCallback(
        (project: IProject) => {
            wm.open('project-detail', {
                payload: {
                    projectId: project._id.toString(),
                    projectName: project.name,
                },
            });
        },
        [wm]
    );

    const openTask = useCallback(
        (project: IProject, taskIndex: number) => {
            wm.open('project-detail', {
                payload: {
                    projectId: project._id.toString(),
                    projectName: project.name,
                    initialOpenTaskIndex: String(taskIndex),
                },
            });
        },
        [wm]
    );

    const filteredProjects = projects
        .map((project) => {
            const tasks = (project.tasks ?? []).filter((task) => {
                const assigneeIds = getTaskAssigneeEmployeeIds(task);
                if (auth.employeeId && assigneeIds.includes(auth.employeeId)) return true;
                return task.assignedTo === currentUserEmployeeName;
            });
            if (tasks.length === 0) return null;
            return { ...project, tasks };
        })
        .filter(Boolean) as IProject[];

    const filteredContent = contentItems.filter((item) => {
        if (!auth.employeeId) return true;
        return item.assignedToEmployeeId?.toString() === auth.employeeId;
    });

    if (loading) {
        return <div className="p-4 text-sm text-zinc-500">Loading agenda…</div>;
    }

    if (error) {
        return <div className="p-4 text-sm text-red-400">{error}</div>;
    }

    return (
        <div className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {(['today', 'weekly', 'monthly'] as TimeframeType[]).map((tf) => (
                    <button
                        key={tf}
                        type="button"
                        onClick={() => setTimeframe(tf)}
                        className={`px-2.5 py-1 text-xs rounded border ${
                            timeframe === tf
                                ? 'bg-primary-light border-primary text-primary'
                                : 'border-border text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        {tf.charAt(0).toUpperCase() + tf.slice(1)}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => refresh()}
                    className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
                >
                    Refresh
                </button>
            </div>
            <AgendaView
                projects={filteredProjects}
                contentItems={filteredContent}
                employees={employees}
                meetings={meetings}
                showTasks
                showContent
                showMeetings
                contentChannelFilter="All"
                timeframe={timeframe}
                currentDate={currentDate}
                onDateChange={setCurrentDate}
                onProjectClick={openProject}
                onTaskClick={openTask}
                currentUserEmployeeName={currentUserEmployeeName}
                currentUserEmployeeId={auth.employeeId}
                currentUserId={auth.userId}
                currentUserRole={auth.role ?? undefined}
                isManagerOrAdmin={auth.isManagerOrAdmin}
                showOnlyMyAssignments
                onAddContent={() => {}}
                onContentItemClick={() => {}}
            />
        </div>
    );
}
