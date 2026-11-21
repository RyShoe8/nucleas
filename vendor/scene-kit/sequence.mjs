// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
import { memoryFiles as fs, bytesOf } from './memory-files.mjs';
import { memoryPath as path } from './memory-files.mjs';
import { loadSet, makeContactProject } from './rigby.mjs';
import { inverse, transformPoint, validateSet } from './contacts.mjs';
import { loadPerformance, socketPoint } from './sockets.mjs';
import { propTransfer, jumpPath } from './prop-action.mjs';
import { appendForeground } from './foreground.mjs';

const key = (time, value, curve = 'linear') => ({ time, value, curve });
const requireThat = (value, message) => { if (!value) throw new Error(message); };
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function compileSequenceFile(file, rigby, overrides = {}) {
  const description = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (description.format !== 'rigby-contact-sequence/1') throw new Error('Expected rigby-contact-sequence/1');
  const speed = overrides.speed ?? 1;
  requireThat(Number.isFinite(speed) && speed >= 0.5 && speed <= 1.5, 'Sequence speed must be 0.5–1.5×');
  description.duration /= speed;
  for (const cast of description.cast ?? []) {
    for (const clip of cast.clips ?? []) { clip.start /= speed; clip.speed = (clip.speed ?? 1) * speed; }
    if (cast.jump) { cast.jump.start /= speed; cast.jump.end /= speed; }
  }
  for (const prop of description.props ?? []) { prop.release /= speed; prop.catch /= speed; }
  const relative = value => path.resolve(path.dirname(file), value);
  const setFile = relative(description.set), set = overrides.set ?? loadSet(setFile);
  const duration = description.duration, fps = 60;
  requireThat(Number.isFinite(duration) && duration > 0 && duration <= 30, 'Sequence duration must be 0–30 seconds');
  requireThat(Array.isArray(description.cast) && description.cast.length > 0 && description.cast.length <= 8, 'Sequence needs 1–8 performers');
  requireThat(Array.isArray(description.props) && description.props.length > 0 && description.props.length <= 8, 'Sequence needs 1–8 props');
  validateSet(set);
  const [a, b, c, d] = set.transform, scale = Math.hypot(a, b);
  requireThat(Math.abs(scale - Math.hypot(c, d)) < 1e-6 && Math.abs(a * c + b * d) < 1e-6, 'Use uniform stage scaling without shear');
  const unstage = inverse(set.transform);
  const art = fs.readFileSync(path.resolve(path.dirname(setFile), set.art.file));
  const base = makeContactProject(set, rigby, art), stage = base.doc, files = rigby.unzip(base.bytes);
  stage.name = description.name;
  if (!overrides.showContacts) stage.slots = stage.slots.filter(s => s.name === 'backdrop');
  const timeline = { name: 'preview', duration, bones: [], slots: [] };
  stage.animations = [timeline]; stage.scene = { actors: [], depth: {}, focal: 1000 };
  const actors = new Map(), sampleTimes = new Set([0, duration]);
  for (let i = 0; i <= Math.ceil(duration * fps); i++) sampleTimes.add(Math.min(i / fps, duration));
  // Exact event/atlas boundaries keep the prop on a drawn hand across pose changes.
  const boundary = time => { if (time >= 0 && time <= duration) { sampleTimes.add(time); if (time > 0) sampleTimes.add(Math.max(0, time - 1e-6)); } };
  const anchor = name => { requireThat(set.anchors[name], `Missing staging contact: ${name}`); return set.anchors[name]; };
  for (const cast of description.cast) {
    requireThat(validId(cast.id) && !actors.has(cast.id) && !stage.bones.some(b => b.name === cast.id), 'Performer IDs must be unique safe names');
    requireThat(Number.isFinite(cast.scale) && cast.scale > 0 && cast.scale <= 4 && [1, -1].includes(cast.facing), 'Invalid performer scale/facing');
    const actor = loadPerformance(relative(cast.binding), rigby); actors.set(cast.id, actor);
    const bone = stage.bones.length, initial = anchor(cast.at);
    stage.bones.push({ name: cast.id, parent: 1, x: initial[0], y: -initial[1], scale_x: cast.scale * cast.facing, scale_y: cast.scale, rotation: 0 });
    stage.slots.push({ name: cast.id, bone, attachment: null, attachments: [], color: [1, 1, 1, 1] });
    requireThat(Array.isArray(cast.clips) && cast.clips.length > 0 && cast.clips[0].start === 0, `${cast.id}: first clip must start at zero`);
    let previous = -1;
    const clips = cast.clips.map(clip => {
      const anim = actor.sk.animations.find(a => a.name === clip.animation), speed = clip.speed ?? 1;
      requireThat(anim && Number.isFinite(clip.start) && clip.start > previous && clip.start < duration && Number.isFinite(speed) && speed >= 0.1 && speed <= 4, `${cast.id}: invalid clip or timing: ${clip.animation}`);
      previous = clip.start; boundary(clip.start);
      for (const slot of anim.slots) for (const k of slot.attachment ?? []) boundary(clip.start + k.time / speed);
      return { animation: clip.animation, start: clip.start, speed, loops: 1, blend: 0 };
    });
    stage.scene.actors.push({ id: cast.id, name: actor.binding.name, bone: cast.id, slot: cast.id, source: cast.id + '.rigby', ground: 0, flip: false, skin: null, clips: { preview: clips } });
    if (cast.jump) {
      const jump = cast.jump;
      requireThat(jump.start >= 0 && jump.end <= duration, 'Jump must finish inside the scene');
      const at = jumpPath(initial, anchor(jump.land), jump.start, jump.end, jump.height);
      boundary(jump.start); boundary(jump.end);
      const times = [...new Set([0, jump.start, jump.end, duration, ...Array.from({ length: Math.ceil((jump.end - jump.start) * fps) + 1 }, (_, i) => Math.min(jump.end, jump.start + i / fps))])].sort((a, b) => a - b);
      timeline.bones.push({ bone, translate: times.map(t => { const p = at(t); return key(t, [p[0] - initial[0], initial[1] - p[1]]); }) });
    }
    for (const [name, bytes] of actor.files) files.set(`actors/${cast.id}/${name}`, bytes);
  }
  // Sample through Rigby's real composed player, including facing, root motion,
  // and stage transforms. Socket calculations are converted back to stage-local.
  const skeleton = rigby.Skeleton.fromJson(JSON.stringify(stage));
  const player = new rigby.ScenePlayer(skeleton, new Map([...actors].map(([id, actor]) => [id, actor.sk]))); player.play('preview');
  const sampleSocket = (ref, time) => {
    const actor = actors.get(ref.actor); requireThat(actor, `Unknown socket performer: ${ref.actor}`);
    player.time = time; player.evaluate(0);
    return transformPoint(unstage, socketPoint(actor, player.actorPoses.get(ref.actor), ref.socket));
  };
  const plans = [], propIds = new Set();
  for (const source of description.props) {
    requireThat(validId(source.id) && !propIds.has(source.id), 'Prop IDs must be unique safe names'); propIds.add(source.id);
    const spec = { ...source, ...(overrides.arcHeight === undefined ? {} : { arcHeight: overrides.arcHeight }) };
    requireThat(spec.catch < duration, 'Catch must leave time to show the held prop');
    const plan = propTransfer(spec, sampleSocket); boundary(spec.release); boundary(spec.catch);
    const assetFile = relative(source.asset), asset = JSON.parse(fs.readFileSync(assetFile, 'utf8'));
    requireThat(asset.format === 'rigby-prop/1' && [asset.size, asset.planeScale].every(v => Array.isArray(v) && v.length === 2 && v.every(x => Number.isFinite(x) && x > 0)), 'Invalid prop dimensions');
    const image = fs.readFileSync(path.resolve(path.dirname(assetFile), asset.file));
    requireThat([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => image[i] === v), 'Prop artwork must be PNG');
    const imageName = `prop-${source.id}`, bone = stage.bones.length;
    requireThat(!stage.bones.some(b => b.name === imageName), `Prop bone conflicts with performer: ${imageName}`);
    // Spin below the plane scale: the markings rotate, not the elliptical plane.
    stage.bones.push({ name: imageName, parent: 1, x: 0, y: 0 },
      { name: imageName + '/plane', parent: bone, x: 0, y: 0, scale_x: asset.planeScale[0], scale_y: asset.planeScale[1] },
      { name: imageName + '/spin', parent: bone + 1, x: 0, y: 0 });
    stage.images.push({ name: imageName, width: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(16), height: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(20), path: `images/${imageName}.png` });
    files.set(`images/${imageName}.png`, image);
    stage.slots.push({ name: imageName, bone: bone + 2, color: [1, 1, 1, 1], attachment: imageName, attachments: [{ name: imageName, image: imageName, width: asset.size[0], height: asset.size[1], x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1 }] });
    plans.push({ spec, plan, bone });
  }
  const times = [...sampleTimes].sort((a, b) => a - b), samples = [];
  for (const item of plans) {
    const translate = [], rotate = [];
    for (const t of times) {
      const s = item.plan.at(t);
      translate.push(key(t, [s.point[0], -s.point[1]])); rotate.push(key(t, -s.rotation));
      samples.push({ time: t, prop: item.spec.id, ...s });
    }
    timeline.bones.push({ bone: item.bone, translate }, { bone: item.bone + 2, rotate });
  }
  const points = [...Object.values(set.anchors), ...samples.map(s => s.point)], xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs) - 220, right = Math.max(...xs) + 220, top = Math.min(...ys) - 260, bottom = Math.max(...ys) + 60;
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(p => transformPoint(set.transform, p));
  const worldX = corners.map(p => p[0]), worldY = corners.map(p => p[1]);
  const bounds = [Math.min(...worldX), Math.min(...worldY), Math.max(...worldX), Math.max(...worldY)];
  stage.settings.frame = { x: (bounds[0] + bounds[2]) / 2, y: -(bounds[1] + bounds[3]) / 2,
    scale: Math.max((bounds[2] - bounds[0]) / 1280, (bounds[3] - bounds[1]) / 720), camera: false };
  appendForeground(stage, set);
  const complete = rigby.Skeleton.fromJson(JSON.stringify(stage)), error = complete.validate(); if (error) throw new Error(error);
  const finalPlayer = new rigby.ScenePlayer(complete, new Map([...actors].map(([id, actor]) => [id, actor.sk]))); finalPlayer.play('preview');
  let maximumAttachmentError = 0;
  for (const sample of samples) {
    if (sample.phase === 'flight') continue;
    finalPlayer.time = sample.time; finalPlayer.evaluate(0);
    const item = plans.find(p => p.spec.id === sample.prop), matrix = finalPlayer.pose.world[item.bone];
    const expected = transformPoint(set.transform, sample.socket);
    const actual = [matrix.tx + matrix.a * sample.grip[0] - matrix.c * sample.grip[1], -(matrix.ty + matrix.b * sample.grip[0] - matrix.d * sample.grip[1])];
    maximumAttachmentError = Math.max(maximumAttachmentError, distance(expected, actual));
  }
  requireThat(maximumAttachmentError < 0.1, 'Baked prop attachment drift exceeds 0.1 pixels');
  files.set('project.json', bytesOf(JSON.stringify(stage)));
  const report = { actor: description.name, duration, frames: times.length, maximumAttachmentError, transfers: plans.length,
    phases: plans.map(({ spec }) => ({ prop: spec.id, from: spec.from.actor, to: spec.to.actor, release: spec.release, catch: spec.catch })) };
  return { bytes: rigby.zip([...files].map(([path, bytes]) => ({ path, bytes })), new Date(2020, 0, 1)), stage, report, duration, actors, samples, plans, set };
}
