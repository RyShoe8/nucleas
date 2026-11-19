'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Saved = {_id:string; name:string; createdAt:string; description?:string};
const ROLES=['design','creative','engineering','support','operations','marketing'];

/** The editor loads only in this module. Company storage stays in the authenticated parent. */
export default function AnimationModule({payload}:{payload?:Record<string,string>}) {
  const frame=useRef<HTMLIFrameElement>(null);
  const pending=useRef<{id:string; companyId:string}|null>(null);
  const [companyId,setCompanyId]=useState(payload?.companyId??'');
  const [companies,setCompanies]=useState<{id:string;name:string}[]>([]);
  const [projects,setProjects]=useState<Saved[]>([]);
  const [ready,setReady]=useState(false);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async (id:string)=>{
    if(!id){setProjects([]);return;}
    const response=await fetch(`/api/os/animation-projects?companyId=${encodeURIComponent(id)}`);
    const body=await response.json();
    if(!response.ok)throw new Error(body.error??'Could not load saved projects.');
    setProjects(body.projects??[]);
  },[]);
  useEffect(()=>{const controller=new AbortController();
    void fetch('/api/os/companies',{signal:controller.signal}).then(r=>r.json()).then(body=>setCompanies(body.companies??[])).catch(()=>{});
    return()=>controller.abort();
  },[]);
  useEffect(()=>{void refresh(companyId).catch(e=>setNotice(e.message));},[companyId,refresh]);
  const send=(message:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({channel:'nucleas-animation',...message},location.origin);
  useEffect(()=>{
    const element=frame.current;if(!element||!ready)return;
    let visible=true;
    const update=()=>send({type:'visibility',visible:visible&&!document.hidden});
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();});
    observer.observe(element);document.addEventListener('visibilitychange',update);update();
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};
  },[ready]);
  useEffect(()=>{
    const listener=async(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.channel!=='nucleas-animation')return;
      const data=event.data;
      if(data.type==='ready')setReady(true);
      if(data.type==='error'){pending.current=null;setBusy(false);setNotice(data.message);}
      const request=pending.current;
      if(data.type!=='save-result'||!request||request.id!==data.id||!(data.bytes instanceof ArrayBuffer))return;
      const target=request.companyId;
      pending.current=null;
      try {
        const response=await fetch(`/api/os/animation-projects?companyId=${encodeURIComponent(target)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:data.bytes});
        const body=await response.json();if(!response.ok)throw new Error(body.error??'Save failed.');
        send({type:'saved',id:data.id});setNotice('New version saved to company assets.');
        await refresh(target);
      }catch(error){setNotice(error instanceof Error?error.message:'Could not save this version.');}
      finally{setBusy(false);}
    };
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[refresh]);
  const open=async(url:string)=>{
    try {const response=await fetch(url);if(!response.ok)throw new Error('Project could not be opened.');
      send({type:'open',bytes:await response.arrayBuffer(),name:'project.rigby'});
    }catch(error){setNotice(error instanceof Error?error.message:'Open failed.');}
  };
  return <div className="flex h-full min-h-0 flex-col text-text-primary">
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 text-xs">
      <div className="mr-auto"><strong className="text-sm">Animation Studio</strong><p className="text-text-secondary">Powered by Rigby2D · editable rigs, timelines and exports</p></div>
      <label>Company <select disabled={busy} value={companyId} onChange={e=>setCompanyId(e.target.value)} className="rounded bg-background-elevated p-2"><option value="">Local project</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="button" disabled={!ready||!companyId||busy} className="rounded bg-primary px-3 py-2 disabled:opacity-40" onClick={()=>{const id=crypto.randomUUID();pending.current={id,companyId};setBusy(true);setNotice('Saving…');send({type:'save',id});}}>Save new version</button>
      <select aria-label="Open saved version" disabled={!ready||busy} value="" className="max-w-60 rounded bg-background-elevated p-2" onChange={e=>void open(`/api/os/animation-projects?companyId=${encodeURIComponent(companyId)}&id=${e.target.value}`)}><option value="">Saved versions</option>{projects.map(p=><option key={p._id} value={p._id}>{p.name} · {new Date(p.createdAt).toLocaleString()}</option>)}</select>
      <select aria-label="Open office character" disabled={!ready||busy} value="" className="rounded bg-background-elevated p-2" onChange={e=>void open(`/office/rigs/${e.target.value}.rigby`)}><option value="">Office characters</option>{ROLES.map(role=><option key={role} value={role}>{role}</option>)}</select>
    </div>
    {notice&&<p role="status" className="bg-background-elevated px-3 py-2 text-xs">{notice}</p>}
    <iframe ref={frame} src="/animation-studio/index.html" title="Rigby2D animation editor" className="min-h-96 w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" />
    <p className="border-t border-border p-2 text-[11px] text-text-secondary">File → Open imports .rigby projects. File → Export produces animation assets. Company saves keep versions up to 3 MB; File → Save downloads larger projects. Saving a draft does not replace live office art.</p>
  </div>;
}
