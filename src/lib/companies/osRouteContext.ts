import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { requireAuth } from '@/lib/auth/middleware';
import { loadCompanyViewer, type CompanyViewer } from '@/lib/companies/companyProfile';

/** Session → CompanyViewer for OS routes, or an error response. */
export async function requireCompanyViewer(request: NextRequest): Promise<CompanyViewer | NextResponse> {
  const session = await requireAuth(request);
  if (session instanceof NextResponse) return session;
  await connectDB();
  const viewer = await loadCompanyViewer(session.userId);
  if (!viewer) return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
  return viewer;
}
