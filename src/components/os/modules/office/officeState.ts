import type { ActivityItem } from '@/lib/activity/types-client';
import { TEAM, TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import { jobIsBusy, type JobView } from '../jobs/JobCard';
import { memberOf, queueFor } from '../jobs/workQueue';

/**
 * The office as data: one room per company, a desk for each team member, and what each one is doing.
 * Built from what the Work window already loads, so the office and the queue always agree.
 */

/** waiting: has something for you · working: running now · idle: has jobs, nothing happening · away: no work assigned. */
export type MemberState = 'waiting' | 'working' | 'idle' | 'away';

export interface Desk {
    role: TeamRole;
    name: string;
    state: MemberState;
    /** What they are saying, in a few words: the oldest thing waiting, or what is running. */
    says: string | null;
    waiting: number;
    jobs: number;
}

export interface Screen { label: string; value: string; change: number | null }

export interface Room {
    companyId: string;
    name: string;
    color: string;
    desks: Desk[];
    waiting: number;
    working: number;
    screens: Screen[];
}

export interface TodayMetrics {
    companyId: string;
    metrics: Record<string, { current: number; change: number | null; unit: 'count' | 'money' | 'percent' | 'seconds' | string }>;
}

const SCREEN_ORDER: { key: string; label: string }[] = [
    { key: 'sessions', label: 'Sessions' },
    { key: 'users_new', label: 'New users' },
    { key: 'leads_new', label: 'Leads' },
    { key: 'revenue_total', label: 'Revenue' },
    { key: 'customers_new', label: 'Customers' },
    { key: 'subscribers_active', label: 'Subscribers' },
    { key: 'mrr', label: 'MRR' },
];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function screenValue(current: number, unit: string): string {
    return unit === 'money' ? `$${compact.format(current)}` : compact.format(current);
}

/** The members who work in every office, in a steady order. Tester is reserved and never shown. */
export const OFFICE_ROLES: TeamRole[] = TEAM_ROLES.filter((role) => TEAM[role].active);

export function buildOffice(input: {
    companies: { id: string; name: string; color?: string }[];
    jobs: JobView[];
    activity: ActivityItem[];
    today: TodayMetrics[];
}): Room[] {
    const rooms = input.companies.map((company): Room => {
        const jobs = input.jobs.filter((job) => job.companyId === company.id);
        const activity = input.activity.filter((item) => item.companyId === company.id);
        const desks = OFFICE_ROLES.map((role): Desk => {
            const own = jobs.filter((job) => memberOf(job) === role);
            const queue = own.flatMap((job) => queueFor(job).map((item) => ({ item, job }))).sort((a, b) => a.item.since.localeCompare(b.item.since));
            const code = role === 'engineering' ? activity.filter((item) => item.kind === 'build') : [];
            const waitingCode = code.filter((item) => item.group === 'you' || item.group === 'failed');
            const running = own.find((job) => jobIsBusy(job) || job.status === 'testing');
            const runningCode = code.find((item) => item.group === 'working');
            const waiting = queue.length + waitingCode.length;
            const state: MemberState = waiting ? 'waiting' : running || runningCode ? 'working' : own.some((job) => ['ready', 'active', 'paused'].includes(job.status)) || code.length ? 'idle' : 'away';
            const says = queue[0]?.item.label
                ?? waitingCode[0]?.title
                ?? (running ? `Working on ${running.design?.title ?? 'a job'}: ${running.runs.find((r) => r.status === 'running')?.progressState.label ?? 'starting'}` : null)
                ?? (runningCode ? `Working on ${runningCode.title}` : null);
            return { role, name: TEAM[role].name, state, says, waiting, jobs: own.length + code.length };
        });
        const metrics = input.today.find((row) => row.companyId === company.id)?.metrics ?? {};
        const screens = SCREEN_ORDER.filter((s) => metrics[s.key]).slice(0, 2).map((s) => ({ label: s.label, value: screenValue(metrics[s.key].current, metrics[s.key].unit), change: metrics[s.key].change }));
        return {
            companyId: company.id,
            name: company.name,
            color: company.color || '#64748b',
            // Busy desks first, so the eye lands on who needs you, then who is working.
            desks: [...desks].sort((a, b) => rank(a.state) - rank(b.state)),
            waiting: desks.reduce((n, d) => n + d.waiting, 0),
            working: desks.filter((d) => d.state === 'working').length,
            screens,
        };
    });
    return rooms.sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || b.working - a.working || a.name.localeCompare(b.name));
}

function rank(state: MemberState): number {
    return { waiting: 0, working: 1, idle: 2, away: 3 }[state];
}
