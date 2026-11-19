import { NextRequest, NextResponse } from 'next/server';
import { getSession } from './session';

export async function requireAuth(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return session;
}
