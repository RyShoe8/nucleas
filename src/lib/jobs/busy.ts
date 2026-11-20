/** Shared between the work UI and the organization office snapshot. */
export function jobIsBusy(job: {status:string;runs:{status:string}[]}):boolean {
  return job.status==='designing'||job.runs.some(run=>run.status==='running');
}
