import type { JobView } from './JobCard';

/**
 * The one way the job screens talk to the server. Network failures come back as an error message
 * instead of an unhandled rejection, so every caller can show it.
 */
export async function postJobAction(jobId: string, body: Record<string, unknown>): Promise<{ job?: JobView; error?: string }> {
    try {
        const res = await fetch(`/api/os/jobs/${jobId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        return res.ok ? data : { error: data.error ?? `Failed (${res.status})` };
    } catch {
        return { error: 'Could not reach Nucleas. Check your connection and try again.' };
    }
}

/** The job as the server has it now, or null when it could not be loaded. */
export async function fetchJob(jobId: string): Promise<JobView | null> {
    try {
        const res = await fetch(`/api/os/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const body = (await res.json().catch(() => ({}))) as { job?: JobView };
        return body.job ?? null;
    } catch {
        return null;
    }
}
