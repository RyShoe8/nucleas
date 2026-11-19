import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth/session';

export async function POST() {
  try {
    await deleteSession();
    return NextResponse.json({ message: 'Logout successful' });
  } catch {
    // Logout error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
