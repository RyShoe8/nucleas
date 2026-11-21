import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import Asset from '@/lib/models/Asset';
import { inspectRigby, RIGBY_MAX_BYTES, RIGBY_TAG } from '@/lib/animation/rigbyProject';
import {readAnimationBytes,saveAnimationVersion,animationDownloadUrl} from '@/lib/animation/animationStorage';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  if (!(await getCompanyProfile(viewer, companyId))) return NextResponse.json({error:'Company not found.'},{status:404});
  const id = request.nextUrl.searchParams.get('id');
  if (id) {
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({error:'Project not found.'},{status:404});
    const asset = await Asset.findOne({_id:id,linkedClientId:companyId,tags:RIGBY_TAG}).select('_id').lean();
    if (!asset) return NextResponse.json({error:'Project not found.'},{status:404});
    const url = await animationDownloadUrl(viewer,companyId,id);
    if(url)return NextResponse.redirect(url,{status:307,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
    const bytes = await readAnimationBytes(viewer,companyId,id);
    if(!bytes)return NextResponse.json({error:'Project file not found.'},{status:404});
    return new NextResponse(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="animation.rigby"','Cache-Control':'private, no-store'}});
  }
  const projects = await Asset.find({linkedClientId:companyId,tags:RIGBY_TAG}).select('name description createdAt').sort({createdAt:-1}).limit(100).lean();
  return NextResponse.json({projects},{headers:{'Cache-Control':'private, no-store'}});
}

export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  if (!(await getCompanyProfile(viewer,companyId))) return NextResponse.json({error:'Company not found.'},{status:404});
  // Stream with a hard limit even when Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({error:'Choose a Rigby project.'},{status:400});
  const chunks:Uint8Array[]=[]; let size=0;
  while (true) {
    const {done,value}=await reader.read(); if(done)break;
    size+=value.length;
    if(size>RIGBY_MAX_BYTES){await reader.cancel();return NextResponse.json({error:'Company projects support up to 3 MB.'},{status:413});}
    chunks.push(value);
  }
  const bytes=Buffer.concat(chunks);
  let info;
  try { info=inspectRigby(bytes); } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Invalid animation project.'},{status:400});}
  // Every save is a separate canonical Asset. Previous versions are never overwritten.
  const asset=await saveAnimationVersion(viewer,companyId,info.name,`Rigby project · ${info.bones} bones · ${info.animations.map((a:{name:string})=>a.name).join(', ')}`,bytes);
  return NextResponse.json({id:String(asset._id),...info},{status:201});
}
