'use client';
import { useEffect, useState } from 'react';
export default function CreativeStorageSettings({ onReady }: { onReady: (ready: boolean) => void }) {
  const [configured,setConfigured]=useState(false), [error,setError]=useState(''), [revision,setRevision]=useState(0), [checking,setChecking]=useState(true);
  useEffect(()=>{const controller=new AbortController();
    void fetch('/api/os/creative-storage',{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Could not check storage.');return data;}).then(data=>{if(!controller.signal.aborted){setConfigured(Boolean(data.configured));setError(data.error||'');onReady(Boolean(data.configured));}}).catch(e=>{if(!controller.signal.aborted){setConfigured(false);setError(e.message);onReady(false);}}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[onReady,revision]);
  return <details className="text-xs"><summary className="cursor-pointer font-medium">Rogly creative storage · {checking?'Checking connection':configured?'Ready · 64 MB per source':'Connection unavailable'}</summary><div className="mt-3 max-w-xl space-y-2"><p>Uses the existing PlayBound connection and Rogly game storage. Nucleas sources stay in their own private nucleas/creative area, separated by organization and company. No additional key is needed.</p><p>Previous Mongo versions remain readable. Saving creates a new source version without publishing it.</p>{error&&<p role="alert" className="text-red-400">{error}</p>}<button className="ui-button" disabled={checking} onClick={()=>{setChecking(true);setError('');setRevision(r=>r+1);}}>Check connection</button></div></details>;
}
