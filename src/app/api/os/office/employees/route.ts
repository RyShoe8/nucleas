import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireCompanyViewer} from '@/lib/companies/osRouteContext';
import Employee from '@/lib/models/Employee';
import {POST as createEmployee} from '@/app/api/employees/route';
import {invalidateOfficeRoster,removeOfficeEmployee,EmployeeManagementError} from '@/lib/office/employees';
import {getOrganizationForBillingUser} from '@/lib/billing/organizationResolve';
import {syncStripeSubscriptionSeatsForOrganization} from 'billing-engine';

const headers={'Cache-Control':'private, no-store'};
export async function GET(request:NextRequest){
  const viewer=await requireCompanyViewer(request);if(viewer instanceof NextResponse)return viewer;
  const canManage=viewer.role==='Administrator';
  const people=await Employee.find({organizationId:String(viewer.organizationId)}).select('name jobTitle role userId').sort({name:1}).lean();
  return NextResponse.json({canManage,employees:people.map(p=>({id:String(p._id),name:p.name,jobTitle:p.jobTitle,role:p.role,canRemove:canManage&&String(p.userId)!==String(viewer.organizationId)&&String(p.userId)!==viewer.userId&&String(p._id)!==viewer.employeeId}))},{headers});
}
const addSchema=z.object({name:z.string().trim().min(1).max(120),jobTitle:z.string().trim().max(120).optional(),email:z.union([z.literal(''),z.string().trim().email().max(254)]).optional(),role:z.enum(['Administrator','Manager','User']),weeklyHours:z.number().min(0).max(168),employeeType:z.enum(['full-time','part-time','contractor'])}).strict();
export async function POST(request:NextRequest){
  const viewer=await requireCompanyViewer(request);if(viewer instanceof NextResponse)return viewer;
  if(viewer.role!=='Administrator')return NextResponse.json({error:'Only administrators can add employees.'},{status:403});
  const body=addSchema.safeParse(await request.clone().json().catch(()=>null));
  if(!body.success)return NextResponse.json({error:'Enter a name, valid role and weekly hours between 0 and 168.'},{status:400});
  // Reuse canonical roster creation, invitation delivery and subscription-seat checks.
  const response=await createEmployee(new NextRequest(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body.data)}));
  if(!response.ok)return response;
  try{await invalidateOfficeRoster(viewer.organizationId);}catch(error){console.error('[office employees] roster refresh delayed',error);}
  const result=await response.json();
  // Invitation tokens stay server-side; Management needs only the delivery outcome.
  return NextResponse.json({id:String(result.employee?._id??result._id),emailSent:result.emailSent,emailError:result.emailError},{status:201,headers});
}
export async function DELETE(request:NextRequest){
  const viewer=await requireCompanyViewer(request);if(viewer instanceof NextResponse)return viewer;
  const body=await request.json().catch(()=>null);
  try{
    await removeOfficeEmployee(viewer,typeof body?.id==='string'?body.id:'');
    try{const org=await getOrganizationForBillingUser(viewer.userId);if(org?.org)await syncStripeSubscriptionSeatsForOrganization(org.org._id);}catch(error){console.error('[office employees] seat sync failed',error);}
    return NextResponse.json({removed:true},{headers});
  }catch(error){
    if(!(error instanceof EmployeeManagementError))console.error('[office employees] removal failed',error);
    return NextResponse.json({error:error instanceof EmployeeManagementError?error.message:'Could not remove the employee.'},{status:error instanceof EmployeeManagementError?error.status:500,headers});
  }
}
