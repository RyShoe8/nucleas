import 'server-only';
import {OfficeSceneModel} from '@/lib/models/OfficeScene';
import {BrandAsset} from '@/lib/models/BrandAsset';
import Employee from '@/lib/models/Employee';
import {listCompanyProfiles,type CompanyViewer} from '@/lib/companies/companyProfile';
import {listJobs} from '@/lib/jobs/jobs';
import {listActivity} from '@/lib/activity/activity';
import {getTodayOverview} from '@/lib/metrics/query';
import {companyAssignments} from '@/lib/companies/teamAssignments';
import {buildOffice} from '@/components/os/modules/office/officeState';
import {chooseDestinations,OFFICE_LAYOUT_VERSION} from '@/components/os/modules/office/officeSimulation';
import {advanceScene,type OfficeScene,type OfficeSnapshot,type VisitTarget} from './timeline';
import {changeRecreation,newRecreation,type RecreationAction} from './recreation';
import {officeRosterFilter} from './roster';

export class OfficeConflict extends Error {}
type Command={personId:string;target:VisitTarget}|{recreation:RecreationAction};

async function loadRooms(viewer:CompanyViewer,previous:OfficeScene|null) {
  // Internal read-only projection across this org; caller permissions are reapplied to the response.
  // Never use the requesting user's visible subset to allocate shared desks or amenity seats.
  const scope:CompanyViewer={...viewer,userId:String(viewer.organizationId),employeeId:null,role:'Administrator'};
  const metricsDue=!previous||Date.now()-previous.metricsAt>300000;
  const [companies,jobs,activity,today,logos,humans]=await Promise.all([
    listCompanyProfiles(scope),listJobs(scope),listActivity(scope),
    metricsDue?getTodayOverview(scope):Promise.resolve(null),
    BrandAsset.find({organizationId:scope.organizationId,kind:'logo'}).select('companyId url').lean(),
    Employee.find(officeRosterFilter(String(scope.organizationId))).select('name jobTitle role userId').sort({_id:1}).lean(),
  ]);
  const logoByCompany=new Map(logos.map(a=>[String(a.companyId),a.url]));
  const assignments=await companyAssignments(viewer.organizationId,companies.map(c=>c.id));
  const rooms=buildOffice({companies:companies.map(c=>({...c,logo:logoByCompany.get(c.id)??c.logo})),jobs,activity,today:today?.rows??[],assignments,now:Date.now()});
  rooms.unshift({kind:'management',companyId:'management',name:'Management',relationship:'internal',color:'#6eae83',description:'The human team',waiting:0,working:0,screens:[],desks:humans.map(person=>{
    const reports=assignments.filter(a=>a.active&&(a.reviewerEmployeeId===String(person._id)||(!a.reviewerEmployeeId&&String(person.userId)===String(scope.organizationId)))).map(a=>({companyId:a.companyId,companyName:companies.find(c=>c.id===a.companyId)?.name??'Company',role:a.role,name:a.displayName}));
    return {human:true,employeeId:String(person._id),role:'operations',name:person.name,specialty:person.jobTitle||person.role,state:'idle',says:'Human teammate',jobs:reports.length,waiting:0,reports};
  })});
  if(!metricsDue)for(const room of rooms)room.screens=previous!.world.suites.find(s=>s.room.companyId===room.companyId)?.room.screens??[];
  return {rooms,metricsDue};
}

/** Bounded, lazy advancement: no per-user simulation, always-on worker, or frame-by-frame DB writes. */
export async function organizationOffice(viewer:CompanyViewer,command?:Command):Promise<OfficeSnapshot> {
  for(let attempt=0;attempt<4;attempt++) {
    const current=await OfficeSceneModel.findById(viewer.organizationId).lean();
    const previous=current?.scene?.world.layoutVersion===OFFICE_LAYOUT_VERSION?current.scene:null;
    if(!command&&previous&&previous.contextAt>0&&Date.now()-previous.at<5000)return {revision:current!.revision,serverTime:Date.now(),scene:previous};
    const refresh=!previous||Date.now()-previous.contextAt>=20000||Boolean(command&&'personId' in command);
    const context=refresh?await loadRooms(viewer,previous):null;
    const now=Date.now();
    // Rebuild positions for new layouts, retaining shared games and explicit visits.
    const seed=previous??(current?.scene?{...current.scene,actors:[]}:null);
    let scene=advanceScene(seed,context?.rooms,now);
    if(context?.metricsDue)scene.metricsAt=now;
    if(command&&'recreation' in command){
      try{scene.recreation=changeRecreation(scene.recreation??newRecreation(now),command.recreation,now);}catch(error){throw new OfficeConflict(error instanceof Error?error.message:'Could not update the game.');}
    }else if(command) {
      const person=scene.world.people.find(p=>p.id===command.personId);
      if(!person)throw new OfficeConflict('This employee is no longer in the office.');
      if(person.desk.state==='working')throw new OfficeConflict('This employee is working. They can take a break when the run finishes.');
      const destinations=chooseDestinations(scene.world,now/1000,{...scene.overrides,[command.personId]:command.target});
      if(command.target!=='desk'&&destinations.get(command.personId)?.amenity!==command.target)throw new OfficeConflict('That shared space is full. Choose another space or return someone to their desk.');
      scene=advanceScene(scene,undefined,now,command);
    }
    const revision=(current?.revision??0)+1;
    if(current) {
      const saved=await OfficeSceneModel.updateOne({_id:viewer.organizationId,revision:current.revision},{$set:{scene,revision}});
      if(saved.modifiedCount)return {revision,serverTime:Date.now(),scene};
    } else {
      try {await OfficeSceneModel.create({_id:viewer.organizationId,revision,scene});return {revision,serverTime:Date.now(),scene};}
      catch(error) {if((error as {code?:number}).code!==11000)throw error;}
    }
  }
  throw new OfficeConflict('The office changed while your request was being saved. Please try again.');
}
