// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
import { memoryFiles as fs, bytesOf } from './memory-files.mjs';
import { memoryPath as path } from './memory-files.mjs';
import { compileSteps } from './bindings.mjs';
import { buildPinnedBiped } from './biped.mjs';
import { loadSet, makeContactProject } from './rigby.mjs';
import { appendForeground } from './foreground.mjs';

const key = (time, value) => ({ time, value, curve: 'linear' });

export function loadActor(file, rigby) {
  const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
  const source = path.resolve(path.dirname(file), binding.source);
  const files = rigby.unzip(fs.readFileSync(source));
  if (!files.has('project.json')) throw new Error(`Actor has no project.json: ${source}`);
  const raw = JSON.parse(new TextDecoder().decode(files.get('project.json')));
  const doc = binding.prepare ? buildPinnedBiped(raw, binding.prepare, rigby) : raw;
  return { binding, doc, files, source };
}

export function makeInteractionScene(set, actor, compiled, art, rigby, { showContacts = false, holdBefore = 0.6, holdAfter = 0.6 } = {}) {
  if (![holdBefore, holdAfter].every(v => Number.isFinite(v) && v >= 0 && v <= 10)) throw new Error('Preview holds must be 0–10 seconds');
  const [a, b, c, d] = set.transform, sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  if (Math.abs(sx - sy) > 1e-6 || Math.abs(a * c + b * d) > 1e-6) throw new Error('Interaction scenes need uniform set scale without shear to preserve character proportions');
  const base = makeContactProject(set, rigby, art), files = rigby.unzip(base.bytes), stage = base.doc;
  stage.name = `${actor.binding.name} — ${set.name}`;
  if (!showContacts) stage.slots = stage.slots.filter(s => s.name === 'backdrop');
  const bone = stage.bones.length, id = 'performer', duration = holdBefore + compiled.duration + holdAfter;
  stage.bones.push({ name: id, parent: 1, x: 0, y: 0, scale_x: actor.binding.scale * actor.binding.facing, scale_y: actor.binding.scale, rotation: 0 });
  stage.slots.push({ name: id, bone, attachment: null, attachments: [], color: [1, 1, 1, 1] });
  const roots = [key(0, [compiled.samples[0].root[0], -compiled.samples[0].root[1]])];
  for (const sample of compiled.samples) roots.push(key(holdBefore + sample.time, [sample.root[0], -sample.root[1]]));
  const final = compiled.samples.at(-1).root;
  roots.push(key(duration, [final[0], -final[1]]));
  stage.animations = [{ name: 'preview', duration, bones: [{ bone, translate: roots }], slots: [] }];
  stage.scene = { actors: [{ id, name: actor.binding.name, bone: id, slot: id, source: `${id}.rigby`, ground: 0, flip: false, skin: null,
    clips: { preview: [{ animation: compiled.doc.animations[0].name, start: 0, in: 0, out: 0, loops: 1, speed: 1, blend: 0 },
      { animation: compiled.doc.animations[0].name, start: holdBefore, loops: 1, speed: 1, blend: 0 }] } }], depth: {}, focal: 1000 };
  // Foreground meshes sample the same texture and share the set bone. Moving
  // the set cannot leave the near rail or steps behind in the old coordinates.
  appendForeground(stage, set);
  // Frame includes headroom, both landings, and transforms with the complete set.
  const local = compiled.samples.map(s => s.root);
  const centre = [(Math.min(...local.map(p => p[0])) + Math.max(...local.map(p => p[0]))) / 2,
    (Math.min(...local.map(p => p[1])) + Math.max(...local.map(p => p[1]))) / 2 - 100];
  stage.settings.frame = { x: a * centre[0] + c * centre[1] + set.transform[4], y: -(b * centre[0] + d * centre[1] + set.transform[5]), scale: sx * 0.92, camera: false };
  const check = rigby.Skeleton.fromJson(JSON.stringify(stage)).validate();
  if (check) throw new Error(check);
  files.set('project.json', bytesOf(JSON.stringify(stage)));
  for (const [name, bytes] of actor.files) if (name !== 'project.json') files.set(`actors/${id}/${name}`, bytes);
  files.set(`actors/${id}/project.json`, bytesOf(JSON.stringify(compiled.doc)));
  return { bytes: rigby.zip([...files].map(([path, bytes]) => ({ path, bytes })), new Date(2020, 0, 1)), stage, duration };
}

export function compileSceneFile(file, rigby) {
  const description = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (description.format !== 'rigby-interaction-scene/1') throw new Error('Expected rigby-interaction-scene/1');
  const relative = value => path.resolve(path.dirname(file), value);
  const setFile = relative(description.set), set = loadSet(setFile), actor = loadActor(relative(description.actor), rigby);
  if (description.transform) set.transform = description.transform;
  const action = set.actions?.[description.action];
  if (!action) throw new Error(`Missing set action: ${description.action}`);
  const options = { ...action, ...(description.secondsPerStep === undefined ? {} : { secondsPerStep: description.secondsPerStep }) };
  const compiled = compileSteps(actor.doc, actor.binding, set, options, rigby);
  const art = set.art ? fs.readFileSync(path.resolve(path.dirname(setFile), set.art.file)) : null;
  const scene = makeInteractionScene(set, actor, compiled, art, rigby, description);
  return { ...scene, report: { actor: actor.binding.name, ...compiled.report }, actor, compiled, set };
}
