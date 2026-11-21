import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireCompanyViewer} from '@/lib/companies/osRouteContext';
import {getCompanyProfile,listCompanyProfiles} from '@/lib/companies/companyProfile';
import {AMENITIES} from '@/components/os/modules/office/officeActivities';
import {CHARACTER_ROLES} from '@/components/os/modules/office/characters';
import {organizationOffice,OfficeConflict} from '@/lib/office/service';
import {visibleSnapshot,type VisitTarget} from '@/lib/office/timeline';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const commandSchema=z.object({companyId:z.string().regex(/^[a-f0-9]{24}$/i),role:z.enum(CHARACTER_ROLES),memberId:z.string().regex(/^[a-f0-9]{24}$/i).optional(),target:z.string().refine(v=>v==='desk'||Object.hasOwn(AMENITIES,v))}).strict();
const revision=z.number().int().nonnegative();
const recreationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('pool-shot'),revision,angle:z.number().finite().min(-Math.PI*2).max(Math.PI*2),power:z.number().min(50).max(500)}).strict(),
  z.object({kind:z.literal('pool-reset'),revision}).strict(),
  z.object({kind:z.literal('tv-power'),revision}).strict(),
  z.object({kind:z.literal('tv-reset'),revision}).strict(),
  z.object({kind:z.literal('tv-card'),revision,card:z.number().int().min(0).max(11)}).strict(),
  z.object({kind:z.literal('object-use'),revision,object:z.enum(['coffee','water','plant','projector','reception'])}).strict(),
]);
export async function GET(request:NextRequest) {
  const viewer=await requireCompanyViewer(request);
  if(viewer instanceof NextResponse)return viewer;
  try {
    const allowed=new Set((await listCompanyProfiles(viewer)).map(c=>c.id));
    const snapshot=visibleSnapshot(await organizationOffice(viewer),allowed);
    return NextResponse.json({...snapshot,serverTime:Date.now()},{headers});
  } catch(error) {
    console.error('[office] shared scene unavailable',error instanceof Error?error.message:'Unknown');
    return NextResponse.json({error:'Shared office is temporarily unavailable.'},{status:503,headers});
  }
}
export async function POST(request:NextRequest) {
  const viewer=await requireCompanyViewer(request);
  if(viewer instanceof NextResponse)return viewer;
  const body=await request.json().catch(()=>null);
  const play=recreationSchema.safeParse(body);
  if(play.success){
    try{const snapshot=await organizationOffice(viewer,{recreation:play.data});const allowed=new Set((await listCompanyProfiles(viewer)).map(c=>c.id));return NextResponse.json({...visibleSnapshot(snapshot,allowed),serverTime:Date.now()},{headers});}
    catch(error){return NextResponse.json({error:error instanceof OfficeConflict?error.message:'Could not update the game.'},{status:error instanceof OfficeConflict?409:503,headers});}
  }
  const parsed=commandSchema.safeParse(body);
  if(!parsed.success)return NextResponse.json({error:'Invalid office visit.'},{status:400,headers});
  const {companyId,role,target,memberId}=parsed.data;
  if(!await getCompanyProfile(viewer,companyId))return NextResponse.json({error:'Company not found.'},{status:404,headers});
  try {
    const snapshot=await organizationOffice(viewer,{personId:`${companyId}:${memberId??role}`,target:target as VisitTarget});
    const allowed=new Set((await listCompanyProfiles(viewer)).map(c=>c.id));
    return NextResponse.json({...visibleSnapshot(snapshot,allowed),serverTime:Date.now()},{headers});
  } catch(error) {
    return NextResponse.json({error:error instanceof OfficeConflict?error.message:'Could not save the shared office visit.'},{status:error instanceof OfficeConflict?409:503,headers});
  }
}
