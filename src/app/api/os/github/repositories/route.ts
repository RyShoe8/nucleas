import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { isCompanyManager } from '@/lib/companies/companyProfile';
import { githubAppConfigured } from '@/lib/ai/githubPublish';
import { listAppRepositories } from '@/lib/ai/githubAppClient';

export const dynamic = 'force-dynamic';

/** Repositories the GitHub App can reach (every installation). Managers and admins; ?refresh=1 bypasses the cache. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers and administrators can list repositories.' }, { status: 403 });
  if (!githubAppConfigured()) return NextResponse.json({ error: 'The GitHub App is not configured on the server.' }, { status: 503 });
  try {
    const repos = await listAppRepositories({ force: request.nextUrl.searchParams.get('refresh') === '1' });
    return NextResponse.json(
      { repositories: repos.map((r) => ({ fullName: r.fullName, owner: r.owner, repo: r.repo, defaultBranch: r.defaultBranch, private: r.private })) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[os/github/repositories] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Could not list repositories from GitHub.' }, { status: 502 });
  }
}
