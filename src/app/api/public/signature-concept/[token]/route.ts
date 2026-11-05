import { NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { publicSignatureConcept } from '@/lib/publishing/signaturePost';

/** Read by Tailnote's public signature example page. Only the company name and picture leave Nucleas. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await connectDB();
    const concept = await publicSignatureConcept((await params).token);
    if (!concept) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json(concept, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (error) {
    console.error('[signature-concept] could not read concept', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Unavailable.' }, { status: 500 });
  }
}
