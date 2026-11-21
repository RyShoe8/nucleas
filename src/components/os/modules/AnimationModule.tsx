'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthoringControls, RenderControls, SceneControls, type ProjectInfo } from './animation/AnimationControls';

import CreativeStorageSettings from './animation/CreativeStorageSettings';
import { uploadAnimation } from '@/lib/animation/uploadAnimation';

type Saved = { _id: string; name: string; createdAt: string };
type Download = { url: string; name: string; mime: string; bytes: number };
type Report = { actor?: string; duration?: number; maximumFootError?: number; maximumHandError?: number; maximumAttachmentError?: number; phases?: { release: number; catch: number }[] };
type View = 'create' | 'scene' | 'render' | 'editor';
const ROLES = ['design', 'creative', 'engineering', 'support', 'operations', 'marketing'];
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120) || 'animation';

/** One editor/runtime for scene authoring, GIF/video export and canonical company versions. */
export default function AnimationModule({ payload }: { payload?: Record<string, string> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef<{ id: string; type: string; companyId: string } | null>(null);
  const activeCompany = useRef(payload?.companyId ?? '');
  const openedAsset = useRef('');
  const urls = useRef(new Set<string>());
  const [view, setView] = useState<View>(payload?.tool === 'examples' ? 'scene' : payload?.tool === 'gif' || payload?.tool === 'render' ? 'render' : payload?.tool === 'editor' ? 'editor' : 'create');
  const [storageReady, setStorageReady] = useState(false);
  const [companyId, setCompanyId] = useState(payload?.companyId ?? '');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<Saved[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('');
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [output, setOutput] = useState<Download | null>(null), [sceneFile, setSceneFile] = useState<Download | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const send = useCallback((message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ channel: 'nucleas-animation', ...message }, location.origin), []);
  const refresh = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) { setProjects([]); return; }
    const response = await fetch(`/api/os/animation-projects?companyId=${encodeURIComponent(id)}`, { signal });
    const body = await response.json(); if (!response.ok) throw Error(body.error ?? 'Could not load saved versions.');
    if (!signal?.aborted && activeCompany.current === id) setProjects(body.projects ?? []);
  }, []);
  const replaceDownload = useCallback((setter: React.Dispatch<React.SetStateAction<Download | null>>, bytes: ArrayBuffer, name: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime })); urls.current.add(url);
    setter(old => { if (old) { URL.revokeObjectURL(old.url); urls.current.delete(old.url); } return { url, name, mime, bytes: bytes.byteLength }; });
  }, []);
  const request = useCallback((type: string, data: Record<string, unknown> = {}) => {
    if (type === 'describe') { send({ type }); return; }
    if (pending.current || !ready) return;
    const id = crypto.randomUUID(); pending.current = { id, type, companyId: activeCompany.current };
    setBusy(true); setOperation(type); setError(''); setNotice(type === 'render' ? 'Preparing render…' : 'Preparing…'); setProgress(null);
    send({ type, id, ...data });
  }, [ready, send]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/os/companies', { signal: controller.signal }).then(async r => { if (!r.ok) throw Error('Could not load companies.'); return r.json(); }).then(b => setCompanies(b.companies ?? [])).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(); activeCompany.current = companyId; setProjects([]);
    void refresh(companyId, controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [companyId, refresh]);
  useEffect(() => {
    const owned = urls.current;
    return () => { send({ type: 'cancel' }); for (const url of owned) URL.revokeObjectURL(url); owned.clear(); };
  }, [send]);
  useEffect(() => {
    const element = frame.current; if (!element || !ready) return;
    let visible = true;
    const update = () => send({ type: 'visibility', visible: visible && !document.hidden });
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(element); document.addEventListener('visibilitychange', update); update();
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [ready, send]);
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'nucleas-animation') return;
      const data = event.data;
      if (data.type === 'ready') { setReady(true); send({ type: 'describe' }); return; }
      if (data.type === 'description') { setProject(data.project); return; }
      const current = pending.current;
      if (!current || current.id !== data.id) return;
      if (data.type === 'progress') { setNotice(data.message); if (typeof data.progress === 'number') setProgress(data.progress); return; }
      if (data.type === 'opened' && current.type === 'scene-build') return;
      if (data.type === 'error' || data.type === 'cancelled') { pending.current = null; setBusy(false); setProgress(null); setNotice(data.type === 'cancelled' ? 'Cancelled. Existing downloads are still available.' : ''); setError(data.type === 'error' ? data.message : ''); return; }
      try {
        if (data.type === 'save-result' && data.bytes instanceof ArrayBuffer) {
          await uploadAnimation(current.companyId, data.bytes, setNotice);
          send({ type: 'saved', id: data.id }); setNotice('New version saved to company assets.'); await refresh(current.companyId);
        } else if (data.type === 'scene-result' && data.bytes instanceof ArrayBuffer) {
          replaceDownload(setSceneFile, data.bytes, data.contactsOnly ? 'scene-contacts.rigby' : `${safeName(data.report?.actor ?? 'scene')}.rigby`, 'application/octet-stream');
          if (!data.contactsOnly) setReport(data.report);
          setNotice(data.contactsOnly ? 'Contact rig ready. Edit in Setup mode, then upload to rebuild.' : 'Scene built. Use Play in the editor to inspect it, or GIF & video to export.');
        } else if (data.type === 'project-result' && data.bytes instanceof ArrayBuffer) {
          replaceDownload(setSceneFile, data.bytes, `${safeName(data.name)}.rigby`, 'application/octet-stream'); setNotice('Editable project ready to download.');
        } else if (data.type === 'render-result' && data.bytes instanceof ArrayBuffer) {
          replaceDownload(setOutput, data.bytes, data.name, data.mime); setNotice(`Rendered ${data.frames} frames · ${data.files} file${data.files === 1 ? '' : 's'}.`);
        } else if (data.type === 'opened') { setReport(null); setNotice(current.type === 'import-artwork' ? 'Artwork added. Arrange layers and animate in the editor.' : current.type === 'add-actor' ? 'Actor added with an editable clip track.' : current.type === 'new-project' ? 'Project created. Import artwork or add actors to begin.' : 'Project opened.'); }
        else return;
      } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); }
      pending.current = null; setBusy(false); setProgress(null);
    };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, [refresh, replaceDownload, send]);
  const openUrl = async (url: string) => {
    setError(''); try { const response = await fetch(url); if (!response.ok) throw Error('Could not open this project.'); request('open', { bytes: await response.arrayBuffer(), name: 'project.rigby' }); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    const id = payload?.assetId, scope = payload?.companyId;
    if (!ready || !id || !scope || openedAsset.current === id) return;
    const controller = new AbortController();
    void fetch(`/api/os/animation-projects?companyId=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error('Could not open this saved animation.');
      const bytes = await response.arrayBuffer();
      if (!controller.signal.aborted) { openedAsset.current = id; request('open', { bytes, name: 'project.rigby' }); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [ready, payload?.assetId, payload?.companyId, request]);
  return <div className="flex h-full min-h-0 flex-col overflow-auto text-text-primary">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border p-3">
      <div className="mr-auto"><h2 className="font-semibold">Animation Studio</h2><p className="text-xs text-text-secondary">Rigby2D · scenes, GIFs, video and editable animation</p></div>
      <label className="text-xs">Company<select aria-label="Animation company" disabled={busy} value={companyId} onChange={e => setCompanyId(e.target.value)} className="ui-control ml-2 max-w-48"><option value="">Local project</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button disabled={!ready || busy || !companyId || !storageReady} className="ui-button" onClick={() => request('save')}>Save version</button>
    </header>
    <nav aria-label="Animation tools" className="flex shrink-0 flex-wrap gap-2 border-b border-border p-3">{([['create', 'Create'], ['editor', 'Edit'], ['render', 'Export'], ['scene', 'Examples']] as const).map(([id, title]) => <button key={id} aria-pressed={view === id} className={view === id ? 'ui-button-primary' : 'ui-button'} onClick={() => { setView(id); if (ready) send({ type: 'describe' }); }}>{title}</button>)}</nav>
    <details className="shrink-0 border-b border-border p-3 text-xs"><summary className="w-fit cursor-pointer font-medium">Files & sources</summary><div className="mt-3 flex flex-wrap gap-2">
      <label className="ui-button cursor-pointer">Import .rigby<input type="file" accept=".rigby" className="sr-only" disabled={!ready || busy} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 64 * 1024 * 1024) { setError('Local projects support up to 64 MB.'); return; } try { request('open', { bytes: await file.arrayBuffer(), name: file.name }); } catch { setError('Could not read this project.'); } }} /></label>
      <label className="ui-button cursor-pointer">Import PNG layers<input type="file" accept="image/png,.png" multiple className="sr-only" disabled={!ready || busy} onChange={async e => {
        const files = [...(e.target.files ?? [])]; e.target.value = ''; if (!files.length) return;
        if (files.length > 32 || files.reduce((n, f) => n + f.size, 0) > 32 * 1024 * 1024) { setError('Import up to 32 PNG layers / 32 MB at a time.'); return; }
        try { request('import-artwork', { files: await Promise.all(files.map(async f => ({ name: f.name, bytes: await f.arrayBuffer() }))) }); } catch { setError('Could not read the artwork.'); }
      }} /></label>
      <label className="ui-button cursor-pointer">Add actor<input type="file" accept=".rigby" className="sr-only" disabled={!ready || busy} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        if (file.size > 64 * 1024 * 1024) { setError('Actors support up to 64 MB.'); return; }
        try { request('add-actor', { name: file.name, bytes: await file.arrayBuffer() }); } catch { setError('Could not read the actor.'); }
      }} /></label>
      <select aria-label="Open saved version" disabled={!ready || busy || !companyId} value="" className="ui-control max-w-52" onChange={e => void openUrl(`/api/os/animation-projects?companyId=${encodeURIComponent(companyId)}&id=${encodeURIComponent(e.target.value)}`)}><option value="">Saved company versions</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name} · {new Date(p.createdAt).toLocaleString()}</option>)}</select>
      <select aria-label="Open office character" disabled={!ready || busy} value="" className="ui-control" onChange={e => void openUrl(`/office/rigs/${e.target.value}.rigby`)}><option value="">Office character…</option>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
      <button className="ui-button" disabled={!ready || busy} onClick={() => request('download-project')}>Prepare project download</button>
      {sceneFile && <a className="ui-button" href={sceneFile.url} download={sceneFile.name}>Download {sceneFile.name}</a>}
    </div></details>
    {(notice || error || !ready) && <div className="shrink-0 border-b border-border px-3 py-2 text-xs"><p role="status">{ready ? notice : 'Loading animation tools…'}</p>{error && <p role="alert" className="text-red-400">{error}</p>}{progress !== null && <progress aria-label="Render progress" className="w-full" max={1} value={progress} />}{busy && ['render', 'scene-build', 'scene-contacts'].includes(operation) && <button className="ui-button mt-2" onClick={() => send({ type: 'cancel' })}>Cancel</button>}</div>}
    <div className={`grid flex-none lg:min-h-0 lg:flex-1 ${view === 'editor' ? '' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
      {view !== 'editor' && <aside className="border-b border-border p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">{view === 'create' ? <AuthoringControls busy={busy || !ready} send={request} /> : view === 'scene' ? <SceneControls busy={busy || !ready} send={request} /> : <RenderControls project={project} busy={busy || !ready} send={request} />}
        {report && <section className="mt-5 rounded-xl border border-border p-3 text-xs"><h3 className="font-semibold">Contact checks · {report.actor}</h3>{typeof report.duration === 'number' && <p>{report.duration.toFixed(2)} s</p>}{([['maximumFootError', 'Foot error'], ['maximumHandError', 'Hand error'], ['maximumAttachmentError', 'Socket drift']] as const).map(([key, label]) => typeof report[key] === 'number' && <p key={key}>{label}: {report[key]!.toFixed(3)} px</p>)}{report.phases?.map((p, i) => <p key={i}>Release {p.release.toFixed(2)} s → catch {p.catch.toFixed(2)} s</p>)}</section>}
      </aside>}
      <div className="relative flex min-h-[460px] min-w-0 flex-col overflow-auto">
        {output && view === 'render' && <section className="border-b border-border bg-background-elevated p-3"><div className="flex flex-wrap items-center gap-3 text-xs"><strong>Latest export</strong><a href={output.url} download={output.name} className="ui-button-primary">Download {output.name}</a><span>{(output.bytes / 1024 / 1024).toFixed(2)} MB</span><button className="ui-button" onClick={() => { URL.revokeObjectURL(output.url); urls.current.delete(output.url); setOutput(null); }}>Dismiss preview</button></div>{output.mime.startsWith('image/') && /* eslint-disable @next/next/no-img-element -- Local blob GIF preview must remain animated. */ <img src={output.url} alt="Rendered animation preview" className="mt-3 max-h-64 max-w-full object-contain" />}{output.mime.startsWith('video/') && <video src={output.url} controls playsInline preload="metadata" className="mt-3 max-h-64 max-w-full" />}</section>}
        <iframe inert={busy && ['render', 'save', 'download-project'].includes(operation)} ref={frame} src="/animation-studio/index.html" title="Rigby2D animation editor" className="min-h-[460px] min-w-[760px] w-full flex-1 border-0 lg:min-w-0" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" />
        {busy && operation === 'render' && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4"><div className="rounded-xl border border-border bg-background-elevated p-5"><p className="text-sm">{notice}</p><button className="ui-button mt-3" onClick={() => send({ type: 'cancel' })}>Cancel operation</button></div></div>}
      </div>
    </div>
    <footer className="shrink-0 border-t border-border p-2 text-xs text-text-secondary"><CreativeStorageSettings onReady={setStorageReady} /></footer>
  </div>;
}
