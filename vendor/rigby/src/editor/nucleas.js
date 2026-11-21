// Nucleas owns authentication/storage; bounded authoring only, never scripts.
import { checkLocalProject } from '../../../scene-kit/contract.mjs';
import { planBrowserRender } from './nucleas-render-plan.js';
import { renderGif, renderJob, frameRange, canEncodeVideo } from './render/offline.js';
import { zip } from './zip.js';
import { authoringOptions, artworkFiles } from './nucleas-authoring.js';
import { newScene, addFrom } from './sceneui.js';
import { importPngs } from './io.js';
import { memoryFs } from './platform.js';
import { Animation } from '../core/animation.js';

export function connectNucleas(app) {
  if (parent === window) return;
  const send = (message, transfer = []) => parent.postMessage({ channel: 'nucleas-animation', ...message }, location.origin, transfer);
  let active = null;
  const describe = id => send({ type: 'description', id, project: {
    name: app.doc.name || 'Animation', animations: app.doc.animations.map(a => ({ name: a.name, duration: a.duration })),
    skins: app.doc.skins.map(s => s.name).filter(name => name !== 'default'), settings: app.doc.settings, video: canEncodeVideo(),
  } });
  const stop = () => {
    if (!active) return;
    const current = active; current.cancelled = true;
    current.worker?.terminate(); current.reject?.(Error('Cancelled.'));
  };
  const workerTask = (worker, payload, current) => new Promise((resolve, reject) => {
    current.worker = worker; current.reject = reject;
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return send({ type: 'progress', id: current.id, message: data.message });
      worker.terminate(); current.worker = null; current.reject = null;
      if (data.error || data.type === 'error') reject(Error(data.error || data.message)); else resolve(data);
    };
    worker.onerror = error => { worker.terminate(); current.worker = null; current.reject = null; reject(Error(error.message || 'Animation worker failed.')); };
    worker.postMessage(payload, payload.frames ? payload.frames.map(f => f.buffer) : []);
  });
  const open = async (bytes, name, id) => {
    checkLocalProject(new Uint8Array(bytes));
    if (!(await app.confirmDiscard())) { send({ type: 'cancelled', id }); return false; }
    if (active?.cancelled) { send({ type: 'cancelled', id }); return false; }
    const file = new File([bytes], name || 'project.rigby');
    const result = await app.openFrom(file.name, memoryFs([file]));
    if (!result.ok) throw Error('The editor could not open this project. See its status for details.');
    send({ type: 'opened', id }); describe(id); return true;
  };
  addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'nucleas-animation') return;
    const { type, id, bytes, name } = event.data;
    try {
      if (type === 'visibility') {
        app.nucleasVisible = event.data.visible !== false;
        if (!app.nucleasVisible) { app.playing = false; stop(); app.changed(); }
        dispatchEvent(new Event('nucleas-visibility'));
        return;
      }
      if (type === 'cancel') { stop(); return; }
      if (type === 'describe') { describe(id); return; }
      if (type === 'saved' && app.nucleasPendingSave?.id === id) {
        app.saved = app.nucleasPendingSave.snapshot; app.nucleasPendingSave = null; app.setStatus('Saved a new version to Nucleas'); return;
      }
      if (active) throw Error('Finish or cancel the current animation operation first.');
      if (['new-project', 'import-artwork', 'add-actor'].includes(type)) {
        active = { id, cancelled: false };
        try {
          if (type === 'new-project') {
            const options = authoringOptions(event.data.options), before = app.doc;
            if (options.kind === 'scene') await newScene(app); else await app.newDocument('film');
            if (app.doc === before) { send({ type: 'cancelled', id }); return; }
            app.doc.name = options.name;
            Object.assign(app.doc.settings, { width: options.width, height: options.height, fps: options.fps, background: null });
            app.doc.settingsInFile = true;
            if (!app.doc.animations.length) app.doc.animations.push(new Animation('Animation 1', options.duration));
            app.doc.animations[0].duration = options.duration; app.anim = 0;
            if (options.kind === 'scene') {
              app.doc.settings.frame.y = options.height / 2;
              app.doc.bones.find(b => b.name === 'camera').setup.y = options.height / 2;
            }
          } else if (type === 'import-artwork') {
            const files = artworkFiles(event.data.files);
            const bone = app.sel?.bone ?? 0;
            await importPngs(files, bone, app.doc, app.images);
          } else {
            checkLocalProject(new Uint8Array(bytes));
            if (!(await addFrom(app, name || 'actor.rigby', new Uint8Array(bytes)))) throw Error('Could not add this actor. See the editor status for details.');
          }
          app.frameRequest = true; app.commitHistory(false); app.changed();
          send({ type: 'opened', id }); describe(id);
        } finally { active = null; }
        return;
      }
      if (type === 'open' && bytes instanceof ArrayBuffer) { await open(bytes, name, id); return; }
      if (type === 'save' || type === 'download-project') {
        let result;
        const { warnings } = await app.writeWorkfile('project.rigby', { writeFile: async (_path, data) => { result = data; } });
        if (warnings.length) throw Error(warnings.join('; '));
        if (!result) throw Error('No project to save.');
        if (type === 'save' && result.byteLength > 64 * 1024 * 1024) throw Error('Company versions support up to 64 MB. Split this project into smaller scenes or download it locally.');
        app.syncJson();
        if (type === 'save') app.nucleasPendingSave = { id, snapshot: app.docJson };
        const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
        send({ type: type === 'save' ? 'save-result' : 'project-result', id, name: app.doc.name || 'Animation', bytes: buffer }, [buffer]);
        return;
      }
      if (!['scene-build', 'scene-contacts', 'render'].includes(type)) return;
      const current = active = { id, cancelled: false, worker: null, reject: null };
      app.playing = false; app.changed();
      try {
        if (type === 'scene-build' || type === 'scene-contacts') {
          const data = await workerTask(new Worker(new URL('./nucleas-scene-worker.js', import.meta.url), { type: 'module' }), {
            input: event.data.input, contacts: event.data.contacts, contactsOnly: type === 'scene-contacts',
          }, current);
          if (current.cancelled) throw Error('Cancelled.');
          if (type === 'scene-build' && !(await open(data.bytes, 'scene.rigby', id))) return;
          send({ type: 'scene-result', id, bytes: data.bytes, report: data.report, contactsOnly: type === 'scene-contacts' }, [data.bytes]);
        } else {
          const jobs = planBrowserRender(app.doc, event.data.options);
          app.nucleasRendering = true;
          const outputs = []; let size = 0;
          for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            const progress = (done, total) => { send({ type: 'progress', id, message: `${job.animationName} · ${done}/${total} frames · ${i + 1}/${jobs.length} renders`, progress: (i + done / total) / jobs.length }); return !current.cancelled; };
            const files = job.format === 'gif' ? [await renderGif(app.doc, app.images, job, progress, async config => {
              send({ type: 'progress', id, message: 'Encoding GIF palette and frames…' });
              const result = await workerTask(new Worker(new URL('./nucleas-gif-worker.js', import.meta.url), { type: 'module' }), config, current);
              return result.bytes;
            })] : await renderJob(app.doc, app.images, job, progress);
            if (!files || files.some(f => !f) || current.cancelled) throw Error('Cancelled.');
            for (const file of files) {
              size += file.bytes.byteLength;
              if (size > 128 * 1024 * 1024) throw Error('Output exceeds 128 MB. Export fewer animations at a time.');
              outputs.push(file);
            }
          }
          const first = outputs[0], bundled = outputs.length > 1;
          const result = bundled ? zip(outputs.map(f => ({ path: f.name, bytes: f.bytes }))) : first.bytes;
          const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
          const mime = bundled ? 'application/zip' : { gif: 'image/gif', png: 'image/png', mp4: 'video/mp4', webm: 'video/webm' }[jobs[0].format];
          send({ type: 'render-result', id, bytes: buffer, name: bundled ? 'animations.zip' : first.name, mime, files: outputs.length, frames: jobs.reduce((n, j) => n + frameRange(app.doc, j.animation, j.settings.fps, j.start, j.end).count, 0) }, [buffer]);
        }
      } finally {
        current.worker?.terminate(); if (active === current) active = null;
        app.nucleasRendering = false; dispatchEvent(new Event('nucleas-visibility'));
      }
    } catch (error) { send({ type: error.message === 'Cancelled.' ? 'cancelled' : 'error', id, message: error.message || 'Animation operation failed.' }); }
  });
  addEventListener('pagehide', stop);
  send({ type: 'ready' });
}
