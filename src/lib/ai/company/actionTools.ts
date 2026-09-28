import 'server-only';
import type { ToolDefinition } from '@nucleas/ai-contracts';
import type { CompanyProfile, CompanyViewer } from '@/lib/companies/companyProfile';
import type { CostLevel } from '@/lib/ai/engine/select';
import type { ExtraToolSet } from '@/lib/ai/tools/runToolLoop';
import type { ProgressFn } from '@/lib/ai/progress';
import { proposeCodeChange, type BuildView } from '@/lib/building/builds';
import { createJob, type JobView } from '@/lib/jobs/jobs';
import { companiesWithRepositories } from '@/lib/building/companyCode';
import { matchCompany } from './companyTools';

/**
 * Actions any Ask model can take (Direct mode included): plan a code change against a company's
 * repository, or have Nucleas design a job. Both run the same processes as Orchestrated mode and
 * wait for a person's approval; the resulting card is attached to the reply.
 */

export interface ActionResults {
  build?: BuildView;
  job?: JobView;
}

export async function withActionTools(
  base: ExtraToolSet,
  options: { viewer: CompanyViewer; companies: CompanyProfile[]; level: CostLevel; signal?: AbortSignal; onProgress?: ProgressFn }
): Promise<{ toolSet: ExtraToolSet; results: ActionResults; codeCompanies: string[] }> {
  const results: ActionResults = {};
  const repos = await companiesWithRepositories(options.viewer, options.companies.map((c) => c.id));
  const withCode = options.companies.filter((c) => repos.has(c.id));
  const names = (list: CompanyProfile[]) => (list.length ? { enum: list.map((c) => c.name) } : {});

  const definitions: ToolDefinition[] = [
    ...(withCode.length
      ? [
          {
            type: 'function' as const,
            function: {
              name: 'plan_code_change',
              description: `Plan a change to a company's website or app code (fix, remove, add, edit) by reading its repository. Use it for requests like "remove X from this page" instead of guessing about the code. The plan waits for a person's approval. Companies with a repository: ${withCode.map((c) => `${c.name} (${repos.get(c.id)})`).join(', ')}.`,
              parameters: {
                type: 'object',
                properties: {
                  company: { type: 'string', description: 'Company name', ...names(withCode) },
                  request: { type: 'string', description: 'The full change request, standing alone: page or URL, what is wrong, what it should be instead' },
                },
                required: ['company', 'request'],
              },
            },
          },
        ]
      : []),
    {
      type: 'function',
      function: {
        name: 'design_job',
        description:
          'Have Nucleas design a job: non-code work for a company (research and collect details, add items to a catalog, content, outreach like earning backlinks, anything repeating such as "every day…"). Nucleas investigates, asks what it must, and a person approves it.',
        parameters: {
          type: 'object',
          properties: {
            company: { type: 'string', description: 'Company name', ...names(options.companies) },
            request: { type: 'string', description: 'The full request: what, how often, where results should go if said' },
          },
          required: ['company', 'request'],
        },
      },
    },
  ];
  const own = new Set(definitions.map((d) => d.function.name));

  const execute: ExtraToolSet['execute'] = async (name, argumentsJson, context) => {
    if (!own.has(name)) return base.execute(name, argumentsJson, context);
    let args: { company?: unknown; request?: unknown } = {};
    try {
      args = JSON.parse(argumentsJson || '{}');
    } catch {
      return JSON.stringify({ ok: false, error: 'Arguments must be a JSON object.' });
    }
    const company = matchCompany(options.companies, args.company);
    const request = typeof args.request === 'string' ? args.request.trim() : '';
    if (!company) return JSON.stringify({ ok: false, error: 'Unknown company.' });
    if (request.length < 10) return JSON.stringify({ ok: false, error: 'Describe the request in full.' });

    if (name === 'plan_code_change') {
      if (results.build) return JSON.stringify({ ok: false, error: 'A code change was already planned in this reply.' });
      if (!repos.has(company.id)) return JSON.stringify({ ok: false, error: `${company.name} has no repository connected.` });
      options.onProgress?.(`Planning the code change for ${company.name} (${repos.get(company.id)})`);
      const proposal = await proposeCodeChange(options.viewer, { companyId: company.id, request, level: options.level, signal: options.signal, onProgress: options.onProgress });
      if (!proposal.ok) return JSON.stringify({ ok: false, error: proposal.message });
      results.build = proposal.build;
      return JSON.stringify({ ok: true, planned: proposal.build.title, summary: proposal.build.summary, next: 'The plan is shown to the user to approve, edit or reject. Tell them briefly what it will change.' });
    }

    if (results.job) return JSON.stringify({ ok: false, error: 'A job was already designed in this reply.' });
    options.onProgress?.(`Designing a job for ${company.name}`);
    const created = await createJob(options.viewer, { companyId: company.id, request, level: options.level, signal: options.signal, onProgress: options.onProgress });
    if (!created.ok) return JSON.stringify({ ok: false, error: created.error });
    results.job = created.job;
    return JSON.stringify({
      ok: true,
      status: created.job.status,
      title: created.job.design?.title,
      questions: created.job.design?.questions.map((q) => q.question) ?? [],
      next: created.job.status === 'needs_answers' ? 'The questions are shown to the user to answer.' : 'The design is shown to the user to approve.',
    });
  };

  return { toolSet: { definitions: [...base.definitions, ...definitions], execute }, results, codeCompanies: withCode.map((c) => c.name) };
}
