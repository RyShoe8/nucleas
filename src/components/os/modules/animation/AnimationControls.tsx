'use client';
import { useState } from 'react';
import { catalog, SCENE_DEFAULTS, SCENE_LIMITS } from '../../../../../vendor/scene-kit/contract.mjs';

export type ProjectInfo = { name: string; animations: { name: string; duration: number }[]; skins: string[]; settings: { width: number; height: number; fps: number; background: number[] | null }; video: boolean };
type Send = (type: string, data?: Record<string, unknown>) => void;
const field = 'ui-control mt-1 block w-full';
export function AuthoringControls({ busy, send }: { busy: boolean; send: Send }) {
  const [options, setOptions] = useState({ kind: 'animation', name: 'Untitled animation', width: 960, height: 540, fps: 24, duration: 3 });
  return <div className="space-y-5 text-sm">
    <div><p className="text-xs font-medium uppercase tracking-widest text-primary">Create · refine · export</p><h3 className="mt-2 text-xl font-semibold">Make it your own</h3><p className="mt-2 text-text-secondary">Animate a logo, illustration, character or complete scene. Every layer and keyframe stays editable.</p></div>
    <form onSubmit={e => { e.preventDefault(); send('new-project', { options }); }}>
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
        <label className="block">Project name<input className={field} required maxLength={120} value={options.name} onChange={e => setOptions({ ...options, name: e.target.value })} /></label>
        <label className="block">Start with<select className={field} value={options.kind} onChange={e => setOptions({ ...options, kind: e.target.value })}><option value="animation">Blank animation</option><option value="scene">Scene with camera and actor tracks</option></select></label>
        <div className="grid grid-cols-2 gap-3">{(['width', 'height', 'fps', 'duration'] as const).map(key => <label className="capitalize" key={key}>{key === 'fps' ? 'FPS' : key === 'duration' ? 'Duration (s)' : key}<input className={field} type="number" required min={key === 'duration' ? .1 : 1} max={key === 'duration' ? 120 : key === 'fps' ? 60 : 4096} step={key === 'duration' ? .1 : 1} value={options[key]} onChange={e => setOptions({ ...options, [key]: Number(e.target.value) })} /></label>)}</div>
        <button className="ui-button-primary w-full" type="submit">Create editable project</button>
      </fieldset>
    </form>
    <div className="space-y-3 rounded-xl border border-border p-4 text-xs">
      <p><strong>1. Arrange</strong><br /><span className="text-text-secondary">Open Files & sources to import PNG layers or add any .rigby actor. Use Setup mode to position artwork, bones and joints.</span></p>
      <p><strong>2. Animate</strong><br /><span className="text-text-secondary">Switch to Animate. Move the playhead, pose your artwork and add keys. Refine timing and easing in the timeline.</span></p>
      <p><strong>3. Review & keep</strong><br /><span className="text-text-secondary">Play, scrub and edit directly. Save a new source version, then render a GIF, video or frame sequence.</span></p>
    </div>
    <p className="text-xs text-text-secondary">For a larger canvas, switch to Edit. PSD, SVG, Aseprite and skeleton import are also available in the editor’s File menu.</p>
  </div>;
}

export function SceneControls({ busy, send }: { busy: boolean; send: Send }) {
  const [input, setInput] = useState({ ...SCENE_DEFAULTS });
  const [contacts, setContacts] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const set = (key: string, value: unknown) => setInput(old => ({ ...old, [key]: value }));
  const sequence = catalog.sequences.find(s => s.id === input.sequence);
  return <form className="space-y-4 text-sm" onSubmit={e => { e.preventDefault(); send('scene-build', { input, contacts }); }}>
    <div><h3 className="font-semibold text-lg">Hyperdisc examples</h3><p className="text-xs text-text-secondary mt-1">Optional starting points from your game’s scene kit. Build an editable example, then change its layers, actors and keyframes. Use Create for your own artwork and actions.</p></div>
    <fieldset disabled={busy || reading} className="space-y-4 disabled:opacity-60">
      <label className="block">Workflow<select className={field} value={input.mode === 'stairs' ? 'stairs' : input.sequence} onChange={e => {
        const selected = catalog.sequences.find(s => s.id === e.target.value);
        setInput(old => ({ ...old, mode: selected ? 'sequence' : 'stairs', sequence: selected?.id ?? old.sequence, arcHeight: selected?.arcHeight ?? old.arcHeight })); setContacts(null); setFileName('');
      }}><option value="stairs">Stair descent</option>{catalog.sequences.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      {input.mode === 'stairs' ? <>
        <label className="block">Set<select className={field} value={input.set} onChange={e => { set('set', e.target.value); setContacts(null); setFileName(''); }}>{catalog.sets.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block">Character<select className={field} value={input.actor} onChange={e => set('actor', e.target.value)}>{catalog.actors.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select><span className="text-xs text-text-secondary">{catalog.actors.find(a => a.id === input.actor)?.note}</span></label>
        <label className="block">Action<select className={field} value={input.action} onChange={e => set('action', e.target.value)}>{catalog.sets.find(s => s.id === input.set)?.actions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      </> : <p className="rounded-xl bg-background-elevated p-3 text-xs">Beach · Throwing lane<br />{sequence?.note}</p>}
      <div className="grid grid-cols-2 gap-3">{([['x', 'Horizontal offset (px)'], ['y', 'Vertical offset (px)'], ['scale', 'Set scale']] as const).map(([key, label]) => <label key={key}>{label}<input required className={field} type="number" min={SCENE_LIMITS[key][0]} max={SCENE_LIMITS[key][1]} step={key === 'scale' ? .05 : 1} value={input[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}</div>
      {input.mode === 'stairs' ? <label className="block">Seconds per step<input required type="number" className={field} min="0.2" max="1.2" step="0.02" value={input.secondsPerStep} onChange={e => set('secondsPerStep', Number(e.target.value))} /></label> : <div className="grid grid-cols-2 gap-3"><label>Playback speed<input required type="number" className={field} min="0.5" max="1.5" step="0.05" value={input.pace} onChange={e => set('pace', Number(e.target.value))} /></label><label>Flight arc (px)<input required type="number" className={field} min="0" max="240" step="5" value={input.arcHeight} onChange={e => set('arcHeight', Number(e.target.value))} /></label></div>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={input.showContacts} onChange={e => set('showContacts', e.target.checked)} /> Show contact guides</label>
      <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer font-medium">Edit contact points</summary><p className="my-2 text-xs text-text-secondary">Download contacts, move the named points in Rigby’s Setup mode, then upload the edited project. Motion uses those contacts when you rebuild.</p>
        <button type="button" className="ui-button mb-3" onClick={() => send('scene-contacts', { input })}>Download contact rig</button>
        <label className="block">Edited contacts (.rigby, up to 12 MB)<input type="file" accept=".rigby" className="mt-2 block w-full text-xs" key={input.mode + input.sequence + input.set} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return; setError(''); setContacts(null); setFileName('');
          if (file.size > 12 * 1024 * 1024) { setError('Contact projects must be smaller than 12 MB.'); e.target.value = ''; return; }
          setReading(true); try { setContacts(await file.arrayBuffer()); setFileName(file.name); } catch { setError('Could not read the contact project.'); } finally { setReading(false); }
        }} /></label>
        {fileName && <p className="mt-2 break-all">{fileName} <button type="button" className="underline" onClick={() => { setContacts(null); setFileName(''); }}>Remove</button></p>}
      </details>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <button className="ui-button-primary w-full" type="submit">Build scene</button>
    </fieldset>
    <p className="text-xs text-text-secondary">Contact checks verify placement, not artistic quality. Changing acting or event timing requires rebuilding prop tracks. Original Hyperdisc files remain intact.</p>
  </form>;
}

export function RenderControls({ project, busy, send }: { project: ProjectInfo | null; busy: boolean; send: Send }) {
  const [format, setFormat] = useState('gif'), [name, setName] = useState('animation');
  const [animation, setAnimation] = useState(''), [skin, setSkin] = useState('default'), [all, setAll] = useState(false);
  const [width, setWidth] = useState(480), [height, setHeight] = useState(270), [fps, setFps] = useState(20);
  const [background, setBackground] = useState('project'), [color, setColor] = useState('#151b19'), [quality, setQuality] = useState('high');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [preserveFraming, setPreserveFraming] = useState(true);
  const selected = project?.animations.find(a => a.name === animation) ?? project?.animations[0];
  const chosenSkin = skin === '*' || project?.skins.includes(skin) ? skin : 'default';
  const multiple = all || chosenSkin === '*';
  return <form className="space-y-4 text-sm" onSubmit={e => {
    e.preventDefault(); if (!project || !selected) return;
    send('render', { options: { out: `${name || 'animation'}.${format}`, format, ...(all ? { all: true } : { animation: [selected.name] }), skin: chosenSkin === '*' ? ['default', ...project.skins] : [chosenSkin], width, height, fps, quality, preserveFraming,
      ...(background === 'project' ? {} : { background: background === 'none' ? 'none' : color }),
      ...(!multiple && start !== '' ? { start: Number(start) } : {}), ...(!multiple && end !== '' ? { end: Number(end) } : {}) } });
  }}>
    <div><h3 className="font-semibold text-lg">GIF & video</h3><p className="mt-1 text-xs text-text-secondary">Render the open project with the same options as Rigby’s command-line workflow.</p></div>
    {!project?.animations.length && <p className="rounded-xl border border-border p-3">Create an animation, import a .rigby file or choose an example first.</p>}
    <button type="button" className="ui-button" disabled={busy} onClick={() => send('describe')}>Refresh project details</button>
    <fieldset disabled={busy || !project?.animations.length} className="space-y-4 disabled:opacity-60">
      <label className="block">Filename<input required maxLength={150} pattern="[^/\\:]+" className={field} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block">Format<select className={field} value={format} onChange={e => setFormat(e.target.value)}><option value="gif">Animated GIF</option><option value="mp4" disabled={!project?.video}>MP4 video</option><option value="webm" disabled={!project?.video}>WebM video</option><option value="png">PNG frames</option></select></label>
      <label className="block">Animation<select disabled={all} className={field} value={selected?.name ?? ''} onChange={e => setAnimation(e.target.value)}>{project?.animations.map(a => <option key={a.name} value={a.name}>{a.name} · {a.duration.toFixed(2)} s</option>)}</select></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Export every animation</label>
      <label className="block">Skin<select className={field} value={chosenSkin} onChange={e => setSkin(e.target.value)}><option value="default">Default</option>{project?.skins.map(s => <option key={s} value={s}>{s}</option>)}{!!project?.skins.length && <option value="*">All skins</option>}</select></label>
      <div className="grid grid-cols-3 gap-2">{([['Width', width, setWidth], ['Height', height, setHeight], ['FPS', fps, setFps]] as const).map(([label, value, setter]) => <label key={label}>{label}<input className={field} type="number" required min="1" max={label === 'FPS' ? 60 : 4096} step={label === 'FPS' ? .001 : 1} value={value} onChange={e => setter(Number(e.target.value))} /></label>)}</div>
      <button type="button" className="ui-button text-xs" onClick={() => { if (project) { setWidth(project.settings.width); setHeight(project.settings.height); setFps(project.settings.fps); } }}>Use project dimensions and FPS</button>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={preserveFraming} onChange={e => setPreserveFraming(e.target.checked)} /> Keep composition when resizing</label>
      <p className="text-xs text-text-secondary">Keeps the full camera view at smaller resolutions. Turn off to use Rigby’s original units-per-pixel framing.</p>
      <label className="block">Background<select className={field} value={background} onChange={e => setBackground(e.target.value)}><option value="project">Project background</option><option value="none">Transparent</option><option value="color">Custom color</option></select></label>
      {background === 'color' && <label className="flex items-center gap-3">Background color<input aria-label="Background color" type="color" value={color.slice(0,7)} onChange={e => setColor(e.target.value)} /><input aria-label="Background hex color" className="ui-control w-28" pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" value={color} onChange={e => setColor(e.target.value)} title="#rrggbb or #rrggbbaa" /></label>}
      {['mp4', 'webm'].includes(format) && <label className="block">Video quality<select className={field} value={quality} onChange={e => setQuality(e.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>}
      {!multiple && <div className="grid grid-cols-2 gap-3"><label>First frame<input type="number" min="0" className={field} placeholder="Automatic" value={start} onChange={e => setStart(e.target.value)} /></label><label>Last frame (inclusive)<input type="number" min="0" className={field} placeholder="Automatic" value={end} onChange={e => setEnd(e.target.value)} /></label></div>}
      <p className="text-xs text-text-secondary">{format === 'gif' ? 'GIF loops continuously, has no audio and supports one-bit transparency. Frame delays have a 20 ms minimum.' : format === 'mp4' ? 'MP4 has no transparency; an empty background becomes black.' : 'PNG frames and multi-animation exports download as a ZIP.'} Existing scene artwork stays visible.</p>
      <button className="ui-button-primary w-full" type="submit">Render {format.toUpperCase()}</button>
    </fieldset>
    <p className="text-xs text-text-secondary">Runs on your device. GIF/PNG frame memory is capped at 128 MB. Reduce dimensions or frame range for long scenes. Hidden windows cancel active work.</p>
  </form>;
}
