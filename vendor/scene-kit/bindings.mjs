// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
// Native Rigby IK is the sole limb solver. This module binds named scene
// contacts to existing rig targets and checks the evaluated result.
import { IDENTITY, contactPath, reachRail, stepAction, validateSet } from './contacts.mjs';

const key = (time, value) => ({ time, value, curve: 'linear' });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

export function resolveBinding(doc, binding, rigby) {
  requireThat(binding.format === 'rigby-interaction-binding/1', 'Expected rigby-interaction-binding/1');
  requireThat(binding.scale > 0 && Number.isFinite(binding.scale), 'Character scale must be positive');
  requireThat(binding.facing === 1 || binding.facing === -1, 'Character facing must be 1 or -1');
  requireThat(Array.isArray(binding.feet) && binding.feet.length === 2, 'Binding needs two feet');
  const sk = rigby.Skeleton.fromJson(JSON.stringify(doc)), pose = new rigby.Pose(sk);
  const index = name => {
    const found = sk.bones.map((b, i) => b.name === name ? i : -1).filter(i => i >= 0);
    requireThat(found.length === 1, `Binding needs exactly one bone named ${name}`);
    return found[0];
  };
  const root = index(binding.root);
  const m = pose.world[root];
  requireThat(Math.hypot(m.tx, m.ty, m.a - 1, m.d - 1, m.b, m.c) < 1e-7, 'Interaction rig root must have an identity setup transform');
  const resolveLimb = limb => {
    const upper = index(limb.upper), lower = limb.lower ? index(limb.lower) : null, target = index(limb.target);
    requireThat(sk.bones[target].parent === root, `${limb.target} must be a direct child of the rig root`);
    const bones = lower === null ? [upper] : [upper, lower];
    const ik = sk.ik.find(c => c.target === target && c.bones.length === bones.length && c.bones.every((b, i) => b === bones[i]));
    requireThat(ik && ik.mix === 1 && !ik.stretch && !ik.compress, `${limb.target} needs a full-strength, fixed-length native IK constraint`);
    requireThat(sk.bones[upper].length > 0 && (lower === null || sk.bones[lower].length > 0), `${limb.target}: missing limb lengths`);
    const maximum = bones.reduce((sum, i) => sum + sk.bones[i].length, 0);
    const minimum = lower === null ? maximum : Math.abs(sk.bones[upper].length - sk.bones[lower].length);
    return { ...limb, upper, lower, target, maximum, minimum, base: [pose.world[upper].tx, pose.world[upper].ty] };
  };
  const feet = binding.feet.map(foot => {
    requireThat(finitePair(foot.sole), 'Foot sole must be a two-number offset in rig coordinates');
    requireThat(typeof foot.lower === 'string', 'Feet require two-bone leg chains');
    return resolveLimb(foot);
  });
  requireThat(feet[0].target !== feet[1].target, 'Each foot needs its own target');
  const hand = binding.hand ? resolveLimb(binding.hand) : null;
  const visible = Object.entries(binding.visible ?? {}).map(([name, attachment]) => {
    const slot = sk.slots.findIndex(s => s.name === name);
    requireThat(slot >= 0 && sk.slots[slot].attachments.some(a => a.name === attachment), `Missing visible attachment: ${name}/${attachment}`);
    return { slot, attachment };
  });
  requireThat(visible.length > 0, 'Binding must select its interaction artwork explicitly');
  return { sk, pose, root, index, feet, hand, visible };
}

function characterPoint(point, root, binding) {
  return [(point[0] - root[0]) / (binding.scale * binding.facing), -(point[1] - root[1]) / binding.scale];
}

function fitRoot(root, contacts, feet, binding, hand, rail) {
  // Preserve directed horizontal travel. Only lower/raise the body as necessary
  // to keep both fixed-length legs reachable. Impossible strides fail closed.
  let low = -Infinity, high = Infinity;
  feet.forEach((foot, i) => {
    const dx = (contacts[i][0] - root[0]) / (binding.scale * binding.facing) - foot.sole[0] - foot.base[0];
    const radius = foot.maximum * 0.985;
    requireThat(Math.abs(dx) <= radius, `${foot.target}: stride is wider than this character can reach`);
    const dy = Math.sqrt(radius * radius - dx * dx);
    const centre = contacts[i][1] + (foot.sole[1] + foot.base[1]) * binding.scale;
    low = Math.max(low, centre - dy * binding.scale);
    high = Math.min(high, centre + dy * binding.scale);
  });
  if (hand) {
    const [start, end] = rail, dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    const shoulderX = root[0] + hand.base[0] * binding.scale * binding.facing;
    const constant = nx * (shoulderX - start[0]) + ny * (-hand.base[1] * binding.scale - start[1]);
    const radius = hand.maximum * binding.scale * 0.975;
    if (Math.abs(ny) < 1e-8) requireThat(Math.abs(constant) <= radius, 'Rail cannot be reached at this horizontal position');
    else {
      const ends = [(-radius - constant) / ny, (radius - constant) / ny].sort((a, b) => a - b);
      low = Math.max(low, ends[0]); high = Math.min(high, ends[1]);
    }
  }
  requireThat(low <= high, 'No reachable body height for these foot contacts; reduce the stride or change the rig scale');
  return [root[0], Math.max(low, Math.min(high, root[1]))];
}

export function compileSteps(source, binding, set, options, rigby, { fps = 60, name = 'descend' } = {}) {
  validateSet(set);
  requireThat(Number.isInteger(fps) && fps >= 15 && fps <= 120, 'Interaction fps must be between 15 and 120');
  // Stage placement applies the set transform once to art, actors and rails.
  // Author targets in set-local space so moved/scaled sets reuse the same clip.
  const localSet = { ...set, transform: IDENTITY };
  const action = stepAction(localSet, { ...options, ...(binding.rootOffset ? { rootOffset: binding.rootOffset } : {}) });
  requireThat(action.duration <= 120, 'A contact action must be at most two minutes');
  const result = structuredClone(source), resolved = resolveBinding(result, binding, rigby);
  const { sk, feet, hand, visible } = resolved;
  const rail = hand ? contactPath(localSet, binding.hand.path) : null;
  requireThat(!rail || rail.length === 2, 'Supported handrail must have exactly two endpoint anchors');
  const samples = [], tracks = new Map();
  const track = (bone, t, point) => {
    if (!tracks.has(bone)) tracks.set(bone, { bone, translate: [] });
    tracks.get(bone).translate.push(key(t, [point[0] - sk.bones[bone].setup.x, point[1] - sk.bones[bone].setup.y]));
  };
  const report = { frames: 0, maximumFootError: 0, maximumHandError: 0, maximumRootCorrection: 0, duration: action.duration };
  for (let i = 0; i <= Math.ceil(action.duration * fps); i++) {
    const t = Math.min(i / fps, action.duration), state = action.at(t);
    const root = binding.fitRoot ? fitRoot(state.root, state.feet, feet, binding, hand, rail) : state.root;
    report.maximumRootCorrection = Math.max(report.maximumRootCorrection, distance(root, state.root));
    const targets = state.feet.map((point, n) => {
      const p = characterPoint(point, root, binding), foot = feet[n];
      return [p[0] - foot.sole[0], p[1] - foot.sole[1]];
    });
    feet.forEach((foot, n) => {
      const d = distance(foot.base, targets[n]);
      requireThat(d <= foot.maximum + 1e-5 && d >= foot.minimum - 1e-5, `Foot target ${binding.feet[n].target} unreachable at ${t.toFixed(3)}s (${d.toFixed(1)} vs ${foot.minimum.toFixed(1)}–${foot.maximum.toFixed(1)})`);
      track(foot.target, t, targets[n]);
    });
    let palm = null;
    if (hand) {
      const endpoints = rail.map(p => characterPoint(p, root, binding));
      let reach = hand.lower === null ? hand.maximum : hand.maximum * (binding.hand.reachFraction ?? 0.88);
      if (hand.lower !== null) {
        const [a, b] = endpoints, dx = b[0] - a[0], dy = b[1] - a[1];
        const perpendicular = Math.abs(dx * (hand.base[1] - a[1]) - dy * (hand.base[0] - a[0])) / Math.hypot(dx, dy);
        reach = Math.max(reach, perpendicular + hand.maximum * 0.01);
      }
      requireThat(reach >= hand.minimum && reach <= hand.maximum, 'Hand reach fraction is outside the limb range');
      try { palm = reachRail(hand.base, reach, endpoints[0], endpoints[1], binding.hand.towardEnd !== false); }
      catch (error) { throw new Error(`Hand contact at ${t.toFixed(3)}s: ${error.message}`); }
      track(hand.target, t, palm);
    }
    samples.push({ time: t, root, feet: state.feet, targets, palm, support: state.support });
  }
  const duration = action.duration;
  const animation = { name, duration, bones: [...tracks.values()], slots: sk.slots.map((_, slot) => ({ slot,
    attachment: [{ time: 0, value: visible.find(v => v.slot === slot)?.attachment ?? null, curve: 'stepped' }] })) };
  // This is a derived interaction file; original clips and their bind frames
  // are preserved in the source .rigby, never rewritten in place.
  result.animations = [animation];
  const solved = rigby.Skeleton.fromJson(JSON.stringify(result)), pose = new rigby.Pose(solved);
  for (const sample of samples) {
    pose.reset(solved); pose.apply(solved, solved.animations[0], sample.time, 1); pose.updateWorld(solved);
    feet.forEach(foot => {
      const tip = pose.world[foot.lower], target = pose.world[foot.target];
      const length = solved.bones[foot.lower].length;
      const error = distance([tip.tx + tip.a * length, tip.ty + tip.b * length], [target.tx, target.ty]);
      report.maximumFootError = Math.max(report.maximumFootError, error);
      requireThat(error < 0.1, `${binding.name}: Rigby did not reach a foot contact at ${sample.time.toFixed(3)}s`);
    });
    if (hand) {
      const end = hand.lower ?? hand.upper, m = pose.world[end], target = pose.world[hand.target], length = solved.bones[end].length;
      const error = distance([m.tx + m.a * length, m.ty + m.b * length], [target.tx, target.ty]);
      report.maximumHandError = Math.max(report.maximumHandError, error);
      requireThat(error < 0.1, `${binding.name}: Rigby did not reach the hand contact at ${sample.time.toFixed(3)}s`);
    }
    report.frames++;
  }
  return { doc: result, samples, report, binding, duration };
}
