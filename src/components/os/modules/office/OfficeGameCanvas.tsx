'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {projectActor} from '@/lib/office/timeline';
import type {SharedOfficeFrame} from './useSharedOffice';
import type {World,Point} from './officeSimulation';
import {OfficeGameRenderer,type Selection,type Hit} from './OfficeGameRenderer';
import {loadOfficeRigs} from './officeRig';
import {fitCamera,focusCamera,scenePoint,uniso,zoomAt,type Camera} from './gameCamera';

export interface GameView {camera:Camera;width:number;height:number}
export interface GameControls {focus:(point:Point,zoom?:number)=>void;fit:()=>void;zoom:(factor:number)=>void}
interface Props {world:World;frame:SharedOfficeFrame|null;motion:boolean;selection:Selection|null;onSelect:(target:Selection|null)=>void;onView:(view:GameView)=>void}

/** One culled 30fps canvas; camera input never writes organization state. */
const OfficeGameCanvas=forwardRef<GameControls,Props>(function OfficeGameCanvas(props,ref){
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(props);
 const controls=useRef<GameControls>({focus:()=>{},fit:()=>{},zoom:()=>{}});
 useEffect(()=>{latest.current=props;},[props]);
 useImperativeHandle(ref,()=>({focus:(p,z)=>controls.current.focus(p,z),fit:()=>controls.current.fit(),zoom:f=>controls.current.zoom(f)}),[]);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const ctx=element.getContext('2d',{alpha:false});if(!ctx)return;
  const renderer=new OfficeGameRenderer();
  let width=0,height=0,dpr=1,camera:Camera={x:0,y:0,zoom:1},hits:Hit[]=[],raf=0,last=0,published=0,dirty=true,visible=true,disposed=false;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const pointers=new Map<number,Point>();let down:Point|null=null,travel=0;
  const keys=new Set<string>();
  const report=()=>latest.current.onView({camera:{...camera},width,height});
  const zoom=(factor:number,anchor={x:width/2,y:height/2})=>{camera=zoomAt(camera,anchor,camera.zoom*factor);dirty=true;report();};
  controls.current={zoom,fit:()=>{camera=fitCamera(latest.current.world.width,latest.current.world.height,width,height);dirty=true;report();},focus:(p,z)=>{camera=focusCamera(p,width,height,z??Math.min(1.4,Math.max(.5,width/900)));dirty=true;report();}};
  const resize=new ResizeObserver(([entry])=>{
   const w=entry.contentRect.width,h=entry.contentRect.height;
   if(!w||!h)return;
   const first=!width;camera.x+=(w-width)/2;camera.y+=(h-height)/2;width=w;height=h;
   dpr=Math.min(devicePixelRatio||1,2);element.width=Math.round(w*dpr);element.height=Math.round(h*dpr);
   if(first)camera=focusCamera({x:650,y:440},width,height,Math.min(1.05,width/1350));
   dirty=true;report();
  });resize.observe(element);
  void loadOfficeRigs().then(()=>{dirty=true;}).catch(()=>{});
  let lastFrame:SharedOfficeFrame|null=null,lastSelection:Selection|null=null;
  const tick=(time:number)=>{
   raf=0;if(disposed||document.hidden||!visible)return;
   raf=requestAnimationFrame(tick);if(time-last<1000/30)return;
   const delta=Math.min(50,time-last);last=time;
   if(keys.size){const d=delta*.7;camera.x+=(keys.has('ArrowLeft')||keys.has('a')?d:0)-(keys.has('ArrowRight')||keys.has('d')?d:0);camera.y+=(keys.has('ArrowUp')||keys.has('w')?d:0)-(keys.has('ArrowDown')||keys.has('s')?d:0);dirty=true;}
   const p=latest.current,animate=p.motion&&!preference.matches;
   if(p.frame!==lastFrame||p.selection!==lastSelection){dirty=true;lastFrame=p.frame;lastSelection=p.selection;}
   if(!dirty&&!animate)return;
   if(!width||!height)return;
   const now=p.frame?p.frame.snapshot.serverTime+Math.min(10000,Math.max(0,performance.now()-p.frame.receivedAt)):0;
   const actors=p.frame?.snapshot.scene.actors.map(a=>projectActor(a,Math.max(0,(now-p.frame!.snapshot.scene.at)/1000)))??[];
   ctx.setTransform(dpr,0,0,dpr,0,0);
   hits=renderer.paint(ctx,p.world,actors,now/1000,camera,width,height,p.selection,animate);
   dirty=false;
   if(time-published>250&&keys.size){report();published=time;}
  };
  const wake=()=>{dirty=true;if(!document.hidden&&visible&&!raf)raf=requestAnimationFrame(tick);};
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(!visible){cancelAnimationFrame(raf);raf=0;keys.clear();}else wake();});observer.observe(element);
  const visibility=()=>{keys.clear();if(document.hidden){cancelAnimationFrame(raf);raf=0;}else wake();};
  const point=(e:PointerEvent|WheelEvent)=>{const r=element.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const pointerDown=(e:PointerEvent)=>{if(e.button!==0&&e.button!==1)return;e.preventDefault();element.focus({preventScroll:true});element.setPointerCapture(e.pointerId);const p=point(e);pointers.set(e.pointerId,p);down=p;travel=pointers.size>1?100:0;element.style.cursor='grabbing';};
  const pointerMove=(e:PointerEvent)=>{
   const previous=pointers.get(e.pointerId),p=point(e);if(!previous)return;
   if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)![1];const oldDistance=Math.hypot(previous.x-other.x,previous.y-other.y),newDistance=Math.hypot(p.x-other.x,p.y-other.y);const center={x:(p.x+other.x)/2,y:(p.y+other.y)/2};camera.x+=(p.x-previous.x)/2;camera.y+=(p.y-previous.y)/2;if(oldDistance>1)zoom(newDistance/oldDistance,center);travel=100;}
   else {camera.x+=p.x-previous.x;camera.y+=p.y-previous.y;travel+=Math.hypot(p.x-previous.x,p.y-previous.y);}
   pointers.set(e.pointerId,p);dirty=true;
  };
  const pointerUp=(e:PointerEvent)=>{if(!pointers.has(e.pointerId))return;const p=point(e);pointers.delete(e.pointerId);if(e.type==='pointerup'&&travel<6&&down){const q=scenePoint(p,camera);const hit=[...hits].reverse().find(h=>q.x>=h.x&&q.x<=h.x+h.w&&q.y>=h.y&&q.y<=h.y+h.h);const ground=uniso(q);const suite=latest.current.world.suites.find(s=>ground.x>=s.x&&ground.x<=s.x+s.w&&ground.y>=s.y&&ground.y<=s.y+s.h);latest.current.onSelect(hit?.target??(suite?{kind:'company',id:suite.room.companyId}:null));}down=null;keys.clear();element.style.cursor='grab';report();};
  const wheel=(e:WheelEvent)=>{e.preventDefault();zoom(Math.exp(-e.deltaY*(e.deltaMode===1?.035:.0015)),point(e));};
  const keyDown=(e:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(e.key)){e.preventDefault();keys.add(e.key);}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.15);}else if(e.key==='-'){e.preventDefault();zoom(1/1.15);}else if(e.key==='0'||e.key==='Home'){e.preventDefault();controls.current.fit();}else if(e.key==='Escape')latest.current.onSelect(null);};
  const keyUp=(e:KeyboardEvent)=>keys.delete(e.key),blur=()=>keys.clear();
  element.addEventListener('pointerdown',pointerDown);element.addEventListener('pointermove',pointerMove);element.addEventListener('pointerup',pointerUp);element.addEventListener('pointercancel',pointerUp);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('keydown',keyDown);element.addEventListener('keyup',keyUp);element.addEventListener('blur',blur);
  document.addEventListener('visibilitychange',visibility);preference.addEventListener('change',wake);wake();
  return()=>{disposed=true;cancelAnimationFrame(raf);resize.disconnect();observer.disconnect();renderer.dispose();element.removeEventListener('pointerdown',pointerDown);element.removeEventListener('pointermove',pointerMove);element.removeEventListener('pointerup',pointerUp);element.removeEventListener('pointercancel',pointerUp);element.removeEventListener('wheel',wheel);element.removeEventListener('keydown',keyDown);element.removeEventListener('keyup',keyUp);element.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',wake);};
 },[]);
 return <canvas ref={canvas} tabIndex={0} aria-label="Interactive office. Drag to pan, scroll or pinch to zoom. Arrow keys move the camera, plus and minus zoom, Home fits the building. Select people or furniture to interact." style={{display:'block',width:'100%',height:'100%',touchAction:'none',cursor:'grab',outlineOffset:-3}}/>;
});
export default OfficeGameCanvas;
