import 'server-only';
import {OfficeSceneModel} from '@/lib/models/OfficeScene';
import {BrandAsset} from '@/lib/models/BrandAsset';
import {listCompanyProfiles,type CompanyViewer} from '@/lib/companies/companyProfile';
import {listJobs} from '@/lib/jobs/jobs';
import {listActivity} from '@/lib/activity/activity';
import {getTodayOverview} from '@/lib/metrics/query';
import {buildOffice} from '@/components/os/modules/office/officeState';
import {chooseDestinations} from '@/components/os/modules/office/officeSimulation';
import {advanceScene,type OfficeScene,type OfficeSnapshot,type VisitTarget} from './timeline';

export class OfficeConflict extends Error {}
type Command={personId:string;target:VisitTarget};

async function loadRooms(viewer:CompanyViewer,previous:OfficeScene|null) {
  // Internal read-only projection across this org; caller permissions are reapplied to the response.
  // Never use the requesting user's visible subset to allocate shared desks or amenity seats.
  const scope:CompanyViewer={...viewer,userId:String(viewer.organizationId),employeeId:null,role:'Administrator'};
  const metricsDue=!previous||Date.now()-previous.metricsAt>300000;
  const [companies,jobs,activity,today,logos]=await Promise.all([
    listCompanyProfiles(scope),listJobs(scope),listActivity(scope),
    metricsDue?getTodayOverview(scope):Promise.resolve(null),
    BrandAsset.find({organizationId:scope.organizationId,kind:'logo'}).select('companyId url').lean(),
  ]);
  const logoByCompany=new Map(logos.map(a=>[String(a.companyId),a.url]));
  const rooms=buildOffice({companies:companies.map(c=>({...c,logo:logoByCompany.get(c.id)??c.logo})),jobs,activity,today:today?.rows??[],now:Date.now()});
  if(!metricsDue)for(const room of rooms)room.screens=previous!.world.suites.find(s=>s.room.companyId===room.companyId)?.room.screens??[];
  return {rooms,metricsDue};
}

/** Bounded, lazy advancement: no per-user simulation, always-on worker, or frame-by-frame DB writes. */
export async function organizationOffice(viewer:CompanyViewer,command?:Command):Promise<OfficeSnapshot> {
  for(let attempt=0;attempt<4;attempt++) {
    const current=await OfficeSceneModel.findById(viewer.organizationId).lean();
    const previous=current?.scene??null;
    if(!command&&previous&&Date.now()-previous.at<5000)return {revision:current!.revision,serverTime:Date.now(),scene:previous};
    const refresh=!previous||Date.now()-previous.contextAt>=20000||Boolean(command);
    const context=refresh?await loadRooms(viewer,previous):null;
    const now=Date.now();
    let scene=advanceScene(previous,context?.rooms,now);
    if(context?.metricsDue)scene.metricsAt=now;
    if(command) {
      const person=scene.world.people.find(p=>p.id===command.personId);
      if(!person)throw new OfficeConflict('This employee is no longer in the office.');
      if(person.desk.state==='working'||person.desk.state==='waiting')throw new OfficeConflict('This employee has work to finish or review.');
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
