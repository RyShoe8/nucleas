'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {OfficeSnapshot,VisitTarget} from '@/lib/office/timeline';
import type {RecreationAction} from '@/lib/office/recreation';
export interface SharedOfficeFrame {snapshot:OfficeSnapshot;receivedAt:number}
export function useSharedOffice() {
  const [frame,setFrame]=useState<SharedOfficeFrame|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const alive=useRef(true);
  const accept=useCallback((snapshot:OfficeSnapshot)=>{
    if(!alive.current)return;
    const receivedAt=performance.now();
    // Server work can take much longer than transit. Do not mistake half that work
    // for network latency and put the person who saved a visit seconds ahead.
    setFrame(current=>{
      if(current&&current.snapshot.revision>snapshot.revision)return current;
      if(current&&JSON.stringify(current.snapshot.scene.world)===JSON.stringify(snapshot.scene.world))snapshot.scene.world=current.snapshot.scene.world;
      return {snapshot,receivedAt};
    });
    setError(null);
  },[]);
  useEffect(()=>{
    alive.current=true;
    let busy=false,stopped=false;
    const controller=new AbortController();
    let request:AbortController|null=null;
    const refresh=async()=>{
      if(busy||document.hidden||stopped)return;
      busy=true;
      request=new AbortController();
      try {
        const response=await fetch('/api/os/office',{cache:'no-store',signal:AbortSignal.any([controller.signal,request.signal,AbortSignal.timeout(20000)])});
        if(!response.ok)throw Error('Shared office disconnected. Reconnecting…');
        const data=await response.json() as OfficeSnapshot;
        if(!data.scene?.world||!Array.isArray(data.scene.actors))throw Error('Shared office is unavailable.');
        if(!stopped)accept(data);
      } catch(e){if(!stopped&&!document.hidden)setError(e instanceof Error?e.message:'Shared office is unavailable.');}
      finally {busy=false;}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),10000);
    const visibility=()=>{if(document.hidden)request?.abort();else void refresh();};
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('nucleas:jobs-changed',refresh);
    return()=>{stopped=true;alive.current=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('nucleas:jobs-changed',refresh);};
  },[accept]);
  const visit=useCallback(async(companyId:string,role:string,target:VisitTarget)=>{
    if(saving||!frame)return false;
    setSaving(true);
    try {
      const response=await fetch('/api/os/office',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,role,target}),signal:AbortSignal.timeout(20000)});
      const body=await response.json();
      if(!response.ok)throw Error(body.error??'Could not save the shared visit.');
      accept(body);return true;
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not save the shared visit.');return false;}
    finally{if(alive.current)setSaving(false);}
  },[saving,frame,accept]);
  const play=useCallback(async(action:RecreationAction)=>{
    if(saving||!frame)return false;
    setSaving(true);
    try{
      const response=await fetch('/api/os/office',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),signal:AbortSignal.timeout(20000)});
      const body=await response.json();
      if(!response.ok){if(response.status===409){const fresh=await fetch('/api/os/office',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(fresh.ok)accept(await fresh.json());}throw Error(body.error??'Could not update the game.');}
      accept(body);return true;
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not update the game.');return false;}
    finally{if(alive.current)setSaving(false);}
  },[saving,frame,accept]);
  return {frame,error,saving,visit,play};
}
export type SharedOffice=ReturnType<typeof useSharedOffice>;
