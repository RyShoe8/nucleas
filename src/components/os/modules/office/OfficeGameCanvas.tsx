'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {projectActor} from '@/lib/office/timeline';
import type {SharedOfficeFrame} from './useSharedOffice';
import type {World,Point} from './officeSimulation';
import {OfficeGameRenderer,type Selection,type Hit} from './OfficeGameRenderer';
import {poolBusy} from '@/lib/office/recreation';
import {clampCamera,fitCamera,focusCamera,scenePoint,uniso,zoomAt,type Camera} from './gameCamera';

export interface GameView {camera:Camera;width:number;height:number}
export interface GameControls {focus:(point:Point,zoom?:number)=>void;fit:()=>void;zoom:(factor:number)=>void}
interface Props {world:World;frame:SharedOfficeFrame|null;motion:boolean;selection:Selection|null;onSelect:(target:Selection|null)=>void;onView:(view:GameView)=>void}

/** Event-driven canvas: 12fps for motion, no animation loop at rest or when hidden. */
const OfficeGameCanvas=forwardRef<GameControls,Props>(function OfficeGameCanvas(props,ref){
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(props),wakeRef=useRef<()=>void>(()=>{});
 const controls=useRef<GameControls>({focus:()=>{},fit:()=>{},zoom:()=>{}});
 useEffect(()=>{latest.current=props;wakeRef.current();},[props]);
 useImperativeHandle(ref,()=>({focus:(p,z)=>controls.current.focus(p,z),fit:()=>controls.current.fit(),zoom:f=>controls.current.zoom(f)}),[]);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const ctx=element.getContext('2d',{alpha:false});if(!ctx)return;
  const renderer=new OfficeGameRenderer(()=>wakeRef.current());
  let width=0,height=0,dpr=1,camera:Camera={x:0,y:0,zoom:1},hits:Hit[]=[],raf=0,timer:ReturnType<typeof setTimeout>|undefined,last=0,published=0,dirty=true,visible=true,disposed=false;
  const pointers=new Map<number,Point>();let down:Point|null=null,travel=0;
  const keys=new Set<string>();
  const report=()=>latest.current.onView({camera:{...camera},width,height});
  const clamp=()=>{camera=clampCamera(camera,latest.current.world.width,latest.current.world.height,width,height);};
  const zoom=(factor:number,anchor={x:width/2,y:height/2})=>{camera=zoomAt(camera,anchor,camera.zoom*factor);clamp();wakeRef.current();report();};
  controls.current={zoom,fit:()=>{camera=fitCamera(latest.current.world.width,latest.current.world.height,width,height);clamp();wakeRef.current();report();},focus:(p,z)=>{camera=focusCamera(p,width,height,z??Math.min(1.4,Math.max(.5,width/900)));clamp();wakeRef.current();report();}};
  const resize=new ResizeObserver(([entry])=>{
   const w=entry.contentRect.width,h=entry.contentRect.height;
   if(!w||!h)return;
   const first=!width,turn=(height>width)!==(h>w);camera.x+=(w-width)/2;camera.y+=(h-height)/2;width=w;height=h;
   dpr=Math.min(devicePixelRatio||1,1.25,Math.sqrt(3_000_000/(w*h)));element.width=Math.round(w*dpr);element.height=Math.round(h*dpr);
   if(first||turn)camera=fitCamera(latest.current.world.width,latest.current.world.height,width,height);
   clamp();wakeRef.current();report();
  });resize.observe(element);
  let lastFrame:SharedOfficeFrame|null=null,lastSelection:Selection|null=null,wasAnimating=false;
  const tick=(time:number)=>{
   raf=0;if(disposed||document.hidden||!visible)return;

   const delta=Math.min(100,time-last);last=time;
   if(keys.size){const d=delta*.7;camera.x+=(keys.has('ArrowLeft')||keys.has('a')?d:0)-(keys.has('ArrowRight')||keys.has('d')?d:0);camera.y+=(keys.has('ArrowUp')||keys.has('w')?d:0)-(keys.has('ArrowDown')||keys.has('s')?d:0);dirty=true;}
   const p=latest.current,age=p.frame?performance.now()-p.frame.receivedAt:0;
   const activeIds=new Set(p.world.people.filter(p=>p.desk.state==='working').map(p=>p.id));
   const rec=p.frame?.snapshot.scene.recreation,serverNow=(p.frame?.snapshot.serverTime??0)+age;
   const animate=p.motion&&age<45000&&Boolean((rec&&(poolBusy(rec,serverNow)||rec.tv.revealUntil>serverNow||Object.values(rec.objects).some(at=>serverNow-(at??0)<12000)))||p.frame?.snapshot.scene.actors.some(a=>!a.arrived||activeIds.has(a.id)||a.destination.amenity==='pool'||a.destination.amenity==='gaming'||a.destination.amenity==='coffee'||a.destination.amenity==='water'));
   if(wasAnimating!==animate)dirty=true;wasAnimating=animate;
   if(p.frame!==lastFrame||p.selection!==lastSelection){dirty=true;lastFrame=p.frame;lastSelection=p.selection;}
   if(!dirty&&!animate&&!keys.size)return;
   if(!width||!height)return;
   const now=p.frame?p.frame.snapshot.serverTime+Math.min(45000,Math.max(0,age)):0;
   const actors=p.frame?.snapshot.scene.actors.map(a=>projectActor(a,Math.max(0,(now-p.frame!.snapshot.scene.at)/1000)))??[];
   clamp();ctx.setTransform(dpr,0,0,dpr,0,0);
   hits=renderer.paint(ctx,p.world,actors,now/1000,camera,width,height,p.selection,animate,rec);
   dirty=false;
   if(time-published>250&&keys.size){report();published=time;}
   if(animate||keys.size)timer=setTimeout(()=>{timer=undefined;raf=requestAnimationFrame(tick);},1000/(keys.size?30:12));
  };
  const wake=()=>{dirty=true;clearTimeout(timer);timer=undefined;if(!document.hidden&&visible&&!raf)raf=requestAnimationFrame(tick);};wakeRef.current=wake;
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(!visible){cancelAnimationFrame(raf);clearTimeout(timer);timer=undefined;raf=0;keys.clear();}else wake();});observer.observe(element);
  const visibility=()=>{keys.clear();if(document.hidden){cancelAnimationFrame(raf);clearTimeout(timer);timer=undefined;raf=0;}else wake();};
  const point=(e:PointerEvent|WheelEvent)=>{const r=element.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const pointerDown=(e:PointerEvent)=>{if(e.button!==0&&e.button!==1)return;e.preventDefault();element.focus({preventScroll:true});element.setPointerCapture(e.pointerId);const p=point(e);pointers.set(e.pointerId,p);down=p;travel=pointers.size>1?100:0;element.style.cursor='grabbing';};
  const pointerMove=(e:PointerEvent)=>{
   const previous=pointers.get(e.pointerId),p=point(e);if(!previous)return;
   if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)![1];const oldDistance=Math.hypot(previous.x-other.x,previous.y-other.y),newDistance=Math.hypot(p.x-other.x,p.y-other.y);const center={x:(p.x+other.x)/2,y:(p.y+other.y)/2};camera.x+=(p.x-previous.x)/2;camera.y+=(p.y-previous.y)/2;if(oldDistance>1)zoom(newDistance/oldDistance,center);travel=100;}
   else {camera.x+=p.x-previous.x;camera.y+=p.y-previous.y;travel+=Math.hypot(p.x-previous.x,p.y-previous.y);}
   pointers.set(e.pointerId,p);wake();
  };
  const pointerUp=(e:PointerEvent)=>{if(!pointers.has(e.pointerId))return;const p=point(e);pointers.delete(e.pointerId);if(e.type==='pointerup'&&travel<6&&down){const q=scenePoint(p,camera);const hit=[...hits].reverse().find(h=>q.x>=h.x&&q.x<=h.x+h.w&&q.y>=h.y&&q.y<=h.y+h.h);const ground=uniso(q,Boolean(camera.portrait));const suite=latest.current.world.suites.find(s=>ground.x>=s.x&&ground.x<=s.x+s.w&&ground.y>=s.y&&ground.y<=s.y+s.h);latest.current.onSelect(hit?.target??(suite?{kind:'company',id:suite.room.companyId}:null));}down=null;keys.clear();element.style.cursor='grab';report();};
  const wheel=(e:WheelEvent)=>{e.preventDefault();zoom(Math.exp(-e.deltaY*(e.deltaMode===1?.035:.0015)),point(e));};
  const keyDown=(e:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(e.key)){e.preventDefault();keys.add(e.key);wake();}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.15);}else if(e.key==='-'){e.preventDefault();zoom(1/1.15);}else if(e.key==='0'||e.key==='Home'){e.preventDefault();controls.current.fit();}else if(e.key==='Escape')latest.current.onSelect(null);};
  const keyUp=(e:KeyboardEvent)=>keys.delete(e.key),blur=()=>keys.clear();
  element.addEventListener('pointerdown',pointerDown);element.addEventListener('pointermove',pointerMove);element.addEventListener('pointerup',pointerUp);element.addEventListener('pointercancel',pointerUp);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('keydown',keyDown);element.addEventListener('keyup',keyUp);element.addEventListener('blur',blur);
  document.addEventListener('visibilitychange',visibility);wake();
  return()=>{disposed=true;wakeRef.current=()=>{};clearTimeout(timer);cancelAnimationFrame(raf);resize.disconnect();observer.disconnect();renderer.dispose();element.removeEventListener('pointerdown',pointerDown);element.removeEventListener('pointermove',pointerMove);element.removeEventListener('pointerup',pointerUp);element.removeEventListener('pointercancel',pointerUp);element.removeEventListener('wheel',wheel);element.removeEventListener('keydown',keyDown);element.removeEventListener('keyup',keyUp);element.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 return <canvas ref={canvas} tabIndex={0} aria-label="Interactive office. Drag to pan, scroll or pinch to zoom. Arrow keys move the camera, plus and minus zoom, Home fits the building. Select people or furniture to interact." style={{display:'block',width:'100%',height:'100%',touchAction:'none',cursor:'grab',outlineOffset:-3}}/>;
});
export default OfficeGameCanvas;
