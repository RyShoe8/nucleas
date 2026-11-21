/** Keep tool output valid JSON and disclose every omission; never cut JSON in the middle of a row. */
export function workRegisterOutput<T>(input: { scope: string; jobs: { company: string; count: number; jobs: T[] }[]; responsibilities: unknown[]; registerLimitReached?: boolean }, maxChars = 16_000) {
    const jobs = input.jobs.map(group => ({ ...group, jobs: [...group.jobs] }));
    const responsibilities = [...input.responsibilities];
    const totalJobs = jobs.reduce((sum, group) => sum + group.jobs.length, 0), totalResponsibilities = responsibilities.length;
    const render = () => {
        const includedJobs = jobs.reduce((sum, group) => sum + group.jobs.length, 0);
        return JSON.stringify({ ok: true, scope: input.scope, jobs, responsibilities, coverage: {
            includedJobs, availableJobs: totalJobs, includedResponsibilities: responsibilities.length, availableResponsibilities: totalResponsibilities,
            partial: includedJobs < totalJobs || responsibilities.length < totalResponsibilities || Boolean(input.registerLimitReached),
            registerLimitReached: Boolean(input.registerLimitReached),
            note: 'If partial, say the list is incomplete and fetch the specific company for more detail. Counts are returned records, not an organization-wide total.',
        } });
    };
    let result = render();
    while (result.length > maxChars && (responsibilities.length || jobs.length)) {
        const largest = jobs.reduce<(typeof jobs)[number] | undefined>((a, b) => !a || b.jobs.length > a.jobs.length ? b : a, undefined);
        if (responsibilities.length > (largest?.jobs.length ?? 0)) responsibilities.pop();
        else if (largest?.jobs.length) largest.jobs.pop();
        else jobs.pop();
        result = render();
    }
    return result;
}
