import {chooseDestinations,makeWorld,routeBetween,type Actor,type World} from '@/components/os/modules/office/officeSimulation';
import type {Room} from '@/components/os/modules/office/officeState';
import type {Amenity} from '@/components/os/modules/office/officeActivities';

export type VisitTarget=Amenity|'desk';
export interface OfficeScene {
  at:number;
  contextAt:number;
  metricsAt:number;
  world:World;
  actors:Actor[];
  overrides:Record<string,VisitTarget>;
}
export interface OfficeSnapshot {revision:number;serverTime:number;scene:OfficeScene}

/** Position comes from the server's timestamp, not from a viewer's frame count. */
export function projectActor(actor:Actor,seconds:number):Actor {
  if(actor.arrived||seconds<=0)return actor;
  const next={...actor,point:{...actor.point},route:[...actor.route]};
  let remaining=seconds*58;
  while(next.route.length) {
    const point=next.route[0],dx=point.x-next.point.x,dy=point.y-next.point.y,length=Math.hypot(dx,dy);
    if(Math.abs(dx)>1)next.facing=dx<0?-1:1;
    if(length>remaining){next.point={x:next.point.x+dx*remaining/length,y:next.point.y+dy*remaining/length};break;}
    next.point=point;next.route.shift();remaining-=length;
  }
  next.arrived=next.route.length===0;
  return next;
}

export function advanceScene(previous:OfficeScene|null,rooms:Room[]|undefined,now:number,command?:{personId:string;target:VisitTarget}):OfficeScene {
  const world=rooms?makeWorld(rooms):previous!.world;
  const overrides={...previous?.overrides};
  const people=new Map(world.people.map(p=>[p.id,p]));
  for(const id of Object.keys(overrides)) {
    const person=people.get(id);
    if(!person||person.desk.state==='working'||person.desk.state==='waiting')delete overrides[id];
  }
  if(command)overrides[command.personId]=command.target;
  const desired=chooseDestinations(world,now/1000,overrides);
  const old=new Map(previous?.actors.map(actor=>[actor.id,actor]));
  const previousHomes=new Map(previous?.world.people.map(p=>[p.id,p.home.point]));
  const actors=world.people.map(person=>{
    const home=previousHomes.get(person.id);
    const saved=home?.x===person.home.point.x&&home?.y===person.home.point.y?old.get(person.id):undefined;
    let actor:Actor=saved?projectActor(saved,Math.max(0,(now-previous!.at)/1000)):{id:person.id,point:person.home.point,destination:person.home,route:[],arrived:true,facing:1};
    const destination=desired.get(person.id)!;
    // Finish the current safe route, then start the next. Every viewer receives that same decision.
    if(actor.arrived) {
      if(actor.destination.key!==destination.key||actor.point.x!==destination.point.x||actor.point.y!==destination.point.y) {
        const route=routeBetween(actor.destination,destination);
        actor={...actor,destination,route,arrived:route.length===0,pending:undefined};
      } else actor={...actor,destination,pending:undefined};
    }
    return actor;
  });
  return {at:now,contextAt:rooms?now:previous!.contextAt,metricsAt:previous?.metricsAt??now,world,actors,overrides};
}

/** Filter after allocation: permissions must never reposition shared studios or reshuffle seats. */
export function visibleSnapshot(snapshot:OfficeSnapshot,allowed:Set<string>):OfficeSnapshot {
  const world=snapshot.scene.world;
  const permitted=(room:Room)=>room.kind==='management'||allowed.has(room.companyId);
  const cleanRoom=(room:Room):Room=>room.kind!=='management'?room:{...room,desks:room.desks.map(d=>({...d,reports:d.reports?.filter(r=>allowed.has(r.companyId)),jobs:d.reports?.filter(r=>allowed.has(r.companyId)).length??0}))};
  const people=world.people.filter(p=>permitted(p.room)).map(p=>p.desk.human?{...p,room:cleanRoom(p.room),desk:{...p.desk,reports:p.desk.reports?.filter(r=>allowed.has(r.companyId)),jobs:p.desk.reports?.filter(r=>allowed.has(r.companyId)).length??0}}:p);
  const ids=new Set(people.map(p=>p.id));
  return {...snapshot,scene:{...snapshot.scene,world:{...world,people,suites:world.suites.filter(s=>permitted(s.room)).map(s=>({...s,room:cleanRoom(s.room)}))},actors:snapshot.scene.actors.filter(a=>ids.has(a.id)),overrides:{}}};
}
