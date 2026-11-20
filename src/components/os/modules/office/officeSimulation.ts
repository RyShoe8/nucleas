import type { Desk, Room } from './officeState';
import { CHARACTER_ROLES } from './characters';
import { AMENITIES, type Amenity } from './officeActivities';

export type Point = { x: number; y: number };
export type Suite = { room: Room; x: number; y: number; w: number; h: number; door: Point; lane: number };
export type DeskFacing='north'|'east'|'south'|'west';
export type Destination = { key: string; point: Point; exit: Point[]; pose: 'idle' | 'seated' | 'pool' | 'coffee'; label: string; amenity?: Amenity; collaboration?: boolean; view?: 'rear'; depth?: number; facing?:DeskFacing };
export type Person = { id: string; room: Room; desk: Desk; home: Destination };
export type World = { width: number; height: number; suites: Suite[]; people: Person[]; layoutVersion?: number };
export const personId = (company: string, role: string) => `${company}:${role}`;
export const SPINE = 90;
export const OFFICE_LAYOUT_VERSION = 4;
export const DESK_VECTOR:Record<DeskFacing,Point>={north:{x:0,y:-1},east:{x:1,y:0},south:{x:0,y:1},west:{x:-1,y:0}};
export const AMENITY_POSITION: Record<Amenity, Point & { size: number }> = {
    conference: { x: 285, y: 320, size: 230 }, projector: { x: 285, y: 140, size: 150 },
    pool: { x: 770, y: 340, size: 195 }, gaming: { x: 1100, y: 230, size: 170 },
    couch: { x: 1100, y: 385, size: 230 }, coffee: { x: 755, y: 135, size: 135 },
    water: { x: 950, y: 150, size: 100 }, plant: { x: 1200, y: 140, size: 95 }, reception: { x: 480, y: 577, size: 105 },
};

export function makeWorld(rooms: Room[]): World {
    const owned = rooms.filter(r => r.relationship !== 'client').sort((a,b) => Number(b.kind==='management')-Number(a.kind==='management')||a.companyId.localeCompare(b.companyId));
    const clients = rooms.filter(r => r.relationship === 'client').sort((a,b) => a.companyId.localeCompare(b.companyId));
    // The commons occupies the first two bays. Companies fill a compact grid, with
    // the client wing alongside it; every row joins the same circulation aisle.
    const roomHeight=(room:Room)=>{
      const count=room.kind==='management'?room.desks.length:room.desks.filter(d=>CHARACTER_ROLES.some(r=>r===d.role)).length;
      const rows=Math.ceil(count/(room.relationship==='client'?2:3));
      return Math.max(475,140+Math.max(0,rows-1)*165+(room.kind==='management'?150:270));
    };
    const minimum=owned.some(r=>r.kind==='management')?3:2;
    const candidates=Array.from({length:Math.max(1,Math.min(6,owned.length+2)-minimum+1)},(_,i)=>{
      const columns=i+minimum,ownedRows=Math.ceil((owned.length+2)/columns),lastUsed=(owned.length+2)%columns||columns;
      const lastCapacity=Math.floor((columns-lastUsed)*740/440),perClientRow=Math.floor(columns*740/440);
      const placements=[...owned.map((room,index)=>({room,row:Math.floor((index+2)/columns),x:150+((index+2)%columns)*740,w:680})),...clients.map((room,index)=>{
        const inLast=index<lastCapacity,tail=index-lastCapacity;
        return {room,row:inLast?ownedRows-1:ownedRows+Math.floor(tail/perClientRow),x:inLast?150+lastUsed*740+index*440:150+(tail%perClientRow)*440,w:380};
      })];
      const rows=Math.max(1,...placements.map(p=>p.row+1));
      const heights=Array.from({length:rows},(_,row)=>Math.max(row===0?575:475,...placements.filter(p=>p.row===row).map(p=>roomHeight(p.room))));
      const width=150+columns*740,height=30+heights.reduce((sum,h)=>sum+h+60,0);
      const unused=Math.max(0,(rows*columns-owned.length-2)*740-clients.length*440)/(rows*columns*740);
      const score=Math.abs(Math.log((width*.86+height*.12)/(height*.9)/1.8))+unused*.7;
      return {placements,heights,score};
    });
    const {placements,heights}=candidates.sort((a,b)=>a.score-b.score)[0];
    const suites:Suite[]=placements.map(({room,row,x,w})=>{
      const y=30+heights.slice(0,row).reduce((sum,h)=>sum+h+60,0),h=heights[row],client=room.relationship==='client';
      return {room,x,y,w,h,door:{x:client?x:x+w,y:y+h-35},lane:x+(client?22:650)};
    });
    const people = suites.flatMap(suite => (suite.room.kind==='management'?suite.room.desks:CHARACTER_ROLES.map(role=>suite.room.desks.find(d=>d.role===role)).filter((d):d is Desk=>Boolean(d))).flatMap((desk,index) => {
        if (!desk) return [];
        const role=desk.role;
        const client = suite.room.relationship === 'client';
        const columns=client?2:3;
        const center={x:suite.x+(client?90:125)+(index%columns)*(client?165:190),y:suite.y+140+Math.floor(index/columns)*165};
        const facing:DeskFacing=(['north','east','south','west'] as const)[(hash(suite.room.companyId)+index)%4];
        const distance=client?42:56;
        const vector=DESK_VECTOR[facing],point={x:center.x-vector.x*distance,y:center.y-vector.y*distance};
        // Leave from behind the chair, then around the workstation's footprint to the row aisle.
        const back={x:point.x-vector.x*17,y:point.y-vector.y*17};
        const edgeX=center.x+(client?-46:77),aisleY=center.y+77;
        const chairExit=facing==='south'?[back,{x:edgeX,y:back.y},{x:edgeX,y:aisleY}]:[back,{x:back.x,y:aisleY}];
        const hallX=client?suite.x-30:suite.x+suite.w+30,hallY=suite.y+suite.h+30;
        const id=desk.human?`human:${desk.employeeId}`:personId(suite.room.companyId,role);
        return [{ id, room:suite.room,desk,home:{key:`desk:${id}`,point,facing,pose:'seated',label:desk.says ?? (desk.state==='waiting'?'Needs your review':desk.state==='away'?'No work assigned':'Available'), exit:[...chairExit,{x:suite.lane,y:aisleY},{x:suite.lane,y:suite.door.y},suite.door,{x:hallX,y:suite.door.y},{x:hallX,y:hallY},{x:SPINE,y:hallY}]} as Destination }];
    }));
    return {width:Math.max(1320,...suites.map(s=>s.x+s.w+60)),height:Math.max(640,...suites.map(s=>s.y+s.h+60)),suites,people,layoutVersion:OFFICE_LAYOUT_VERSION};
}

export function amenityDestination(amenity: Amenity, slot: number): Destination {
    const pos=AMENITY_POSITION[amenity];
    let point: Point;
    if(amenity==='conference') point={x:210+(slot%3)*75,y:slot<3?270:425};
    else if(amenity==='pool') point={x:slot%2?865:675,y:slot%2?370:390};
    else if(amenity==='gaming'||amenity==='couch') point={x:1055+slot*45,y:440-slot*15};
    else if(amenity==='coffee') point={x:730+slot*65,y:205};
    else if(amenity==='water') point={x:930+slot*55,y:218};
    else point={x:pos.x,y:pos.y+60};
    const left=amenity==='conference'||amenity==='projector';
    const door={x:left?530:980,y:520};
    const sofa=amenity==='gaming'||amenity==='couch';
    const exit=sofa ? [{x:1220,y:point.y},{x:1220,y:490},{x:980,y:490},door,{x:980,y:580},{x:SPINE,y:580}] : amenity==='reception' ? [{x:SPINE,y:577}] : amenity==='conference' ? [
        {x:point.x,y:slot<3?225:460},{x:545,y:slot<3?225:460},{x:545,y:470},{x:door.x,y:470},door,{x:door.x,y:580},{x:SPINE,y:580},
    ] : [
        {x:point.x,y:amenity==='pool'?455:point.y+35}, {x:left?545:925,y:amenity==='pool'?455:point.y+35}, {x:left?545:925,y:470}, {x:door.x,y:470},door,{x:door.x,y:580},{x:SPINE,y:580},
    ];
    return {key:`${amenity}:${slot}`,point,exit,amenity,pose:amenity==='pool'?'pool':amenity==='coffee'||amenity==='water'?'coffee':amenity==='conference'||sofa?'seated':'idle',label:AMENITIES[amenity].action,...(amenity==='conference'?{facing:slot<3?'south' as const:'north' as const}:{}),...(sofa?{view:'rear' as const,depth:475}:{})};
}

/** Exit via a room's aisle and door; every inter-room route uses the same central spine. */
export function routeBetween(from: Destination,to: Destination): Point[] {
    if(from.key===to.key || (from.point.x===to.point.x&&from.point.y===to.point.y)) return [];
    // Join at the nearest shared aisle, rather than leaving and re-entering the same room.
    const join=from.exit.findIndex(p=>to.exit.some(q=>q.x===p.x&&q.y===p.y));
    const other=join<0?-1:to.exit.findIndex(p=>p.x===from.exit[join].x&&p.y===from.exit[join].y);
    const points=join<0?[...from.exit,...[...to.exit].reverse(),to.point]:[...from.exit.slice(0,join+1),...to.exit.slice(0,other).reverse(),to.point];
    return points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);
}
const hash=(value:string)=>[...value].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);

/** Real work wins. Only live consultations occupy collaboration spaces; idle life is explicitly ambient. */
export function chooseDestinations(world:World, elapsedSeconds:number, overrides:Record<string,Amenity|'desk'>={}):Map<string,Destination> {
    const result=new Map<string,Destination>();
    const occupied=new Map<Amenity,number>();
    let sofaSeats=0;
    const meetingGroups=new Set<string>();
    for(const p of world.people) {
        const group=p.desk.collaboration;
        if(!group || p.desk.state==='waiting') continue;
        const participants=world.people.filter(other=>other.room.companyId===p.room.companyId && other.desk.collaboration?.id===group.id && other.desk.state!=='waiting');
        if(participants.length>=3) {
            if(meetingGroups.size && !meetingGroups.has(group.id)) continue;
            meetingGroups.add(group.id);
            const slot=occupied.get('conference')??0;
            if(slot>=6) continue;
            result.set(p.id,{...amenityDestination('conference',slot),label:`Team meeting: ${group.title}`,collaboration:true});
            occupied.set('conference',slot+1);
        } else if(participants.length===2) {
            const host=participants.find(other=>other.desk.role===group.host)??participants[0];
            result.set(p.id,{...host.home,key:`consult:${group.id}:${p.id}`,point:{x:host.home.point.x+(p.id===host.id?0:55),y:host.home.point.y},pose:p.id===host.id?'seated':'idle',label:`Discussing: ${group.title}`,collaboration:true});
        }
    }
    // Explicit visits reserve seats first, so ambient occupants cannot silently override a request.
    const visitors=[...world.people].sort((a,b)=>Number(Boolean(overrides[b.id]))-Number(Boolean(overrides[a.id])));
    for(const p of visitors) {
        if(result.has(p.id)) continue;
        if(p.desk.human){result.set(p.id,p.home);continue;}
        if(p.desk.state==='working') {result.set(p.id,p.home);continue;}
        const preference=overrides[p.id];
        const seed=hash(p.id);
        // Stagger arrivals and rotate long breaks without a permanent crowd of every employee.
        const epoch=Math.floor((elapsedSeconds+seed%45)/90);
        const available=world.people.filter(p=>!p.desk.human&&p.desk.state!=='working');
        const lead=available[Math.floor(elapsedSeconds/90)%Math.max(1,available.length)];
        const eligible=elapsedSeconds>8+seed%22 && ((seed+epoch)%3===0||lead?.id===p.id);
        const ambient: Amenity[]=['pool','pool','coffee','water','gaming','couch'];
        const amenity=preference && preference!=='desk' ? preference : preference==='desk'||!eligible ? null : ambient[((seed>>>4)+epoch)%ambient.length];
        const sofa=amenity==='gaming'||amenity==='couch';
        const slot=sofa?sofaSeats:amenity?(occupied.get(amenity)??0):0;
        if(amenity && slot<AMENITIES[amenity].capacity) {
            result.set(p.id,amenityDestination(amenity,slot)); occupied.set(amenity,slot+1);if(sofa)sofaSeats++;
        } else result.set(p.id,p.home);
    }
    return result;
}

export type Actor = { id:string; point:Point; destination:Destination; route:Point[]; arrived:boolean; facing:number; pending?:Destination };
export function moveActor(actor:Actor, destination:Destination, seconds:number):Actor {
    if(actor.arrived&&actor.destination.key===destination.key&&!actor.pending) return actor.destination===destination?actor:{...actor,destination};
    let next={...actor,point:{...actor.point},route:[...actor.route]};
    if(destination.key===next.destination.key) next.destination=destination;
    // Finish the current aisle safely before accepting a new target; never jump across furniture.
    if(destination.key!==next.destination.key) {
        if(!next.arrived) next.pending=destination;
        else {next.route=routeBetween(next.destination,destination);next.destination=destination;next.arrived=!next.route.length;next.pending=undefined;}
    } else next.pending=undefined;
    let distance=Math.min(seconds,.25)*58;
    while(distance>0 && next.route.length) {
        const target=next.route[0],dx=target.x-next.point.x,dy=target.y-next.point.y,length=Math.hypot(dx,dy);
        if(Math.abs(dx)>1) next.facing=dx<0?-1:1;
        if(length<=distance) {next.point=target;next.route.shift();distance-=length;}
        else {next.point={x:next.point.x+dx/length*distance,y:next.point.y+dy/length*distance};distance=0;}
    }
    next.arrived=next.route.length===0;
    if(next.arrived && next.pending) { const pending=next.pending; next={...next,destination:pending,route:routeBetween(next.destination,pending),pending:undefined,arrived:false}; }
    return next;
}

export function officeTheme(room:Pick<Room,'name'|'description'|'domain'>):{label:string; objects:string[]} {
    const text=`${room.description??''} ${room.name} ${room.domain??''}`.toLowerCase();
    if(/management|human team/.test(text)) return {label:'Team leadership',objects:['books','chart','globe']};
    if(/casino|gambl|betting/.test(text)) return {label:'Odds & discovery',objects:['trophy','chart','globe']};
    if(/game|gaming|sports|playbound/.test(text)) return {label:'Play & community',objects:['controller','trophy','arcade']};
    if(/bank|payment|finance|pay\b/.test(text)) return {label:'Commerce & payments',objects:['chart','globe','safe']};
    if(/media|marketing|creative|design|content|cinema|demo/.test(text)) return {label:'Creative studio',objects:['camera','palette','books']};
    if(/home|property|hearth|gutter|construction|service/.test(text)) return {label:'Places & services',objects:['house','tools','plant']};
    if(/email|signature|tailnote/.test(text)) return {label:'Identity & correspondence',objects:['mail','palette','books']};
    if(/software|app|nucleas|platform/.test(text)) return {label:'Product studio',objects:['laptop','chart','globe']};
    return {label:'Company studio',objects:['books','globe','plant']};
}

/** Stable per-company finishes: adding staff never changes the company's identity. */
export function studioStyle(room:Room) {
    const seed=hash(room.companyId+room.name),theme=officeTheme(room);
    const finishes=[['#c0b39e','#6c8194','#c3a476'],['#ba9e82','#a8755d','#d7c4a4'],['#afb0aa','#7c8893','#d0b898'],['#b6a68e','#9a815c','#d4c9b1'],['#bfb5a8','#8f9393','#d3b996']];
    const [floor,neutral,trim]=finishes[seed%finishes.length];
    const palette=(room.colorPalette??[]).map(officeColor).filter((c):c is string=>Boolean(c));
    const selected=officeColor(room.color);
    // The standard setup colors are placeholders, not evidence of a blue/gray brand.
    const accent=palette[0]??(selected&&!['#3b82f6','#64748b'].includes(selected)?selected:neutral);
    const secondary=palette[1]??trim;
    return {seed,floor,rug:mixColor(accent,'#333335',.18),trim:secondary,accent,wall:mixColor(accent,'#f5eee2',.78),theme};
}
export function officeColor(value:string|undefined):string|undefined{
    if(!value)return;
    const hex=value.trim().toLowerCase();if(/^#[a-f0-9]{6}$/.test(hex))return hex;
    if(/^#[a-f0-9]{3}$/.test(hex))return '#'+[...hex.slice(1)].map(c=>c+c).join('');
    const rgb=hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/);
    if(rgb)return '#'+rgb.slice(1,4).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join('');
}
export function mixColor(a:string,b:string,t:number){return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');}
