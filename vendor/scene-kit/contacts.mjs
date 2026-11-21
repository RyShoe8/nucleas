// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
// Contact authoring uses pixels, Y down. Rigby remains the only bone/IK solver.
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new Error(message); };
const vector = (value, label, count = 2) => {
  if (!Array.isArray(value) || value.length !== count || !value.every(finite)) fail(`${label}: expected ${count} finite numbers`);
};
const positive = (value, label) => { if (!finite(value) || value <= 0) fail(`${label}: must be positive`); };
export const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = t => t * t * (3 - 2 * t);
const clamp = (t, lo, hi) => Math.max(lo, Math.min(hi, t));

export function transformPoint(m, [x, y]) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function inverse(m) {
  vector(m, 'transform', 6);
  const det = m[0] * m[3] - m[1] * m[2];
  if (!finite(det) || Math.abs(det) < 1e-8) fail('Transform is collapsed or out of range; contacts cannot use zero scale');
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -a * m[4] - c * m[5], -b * m[4] - d * m[5]];
}

export function validateSet(set) {
  if (set?.format !== 'rigby-contact-set/1') fail('Expected rigby-contact-set/1');
  if (typeof set.name !== 'string' || !set.name.trim()) fail('Set needs a name');
  inverse(set.transform);
  if (!set.anchors || typeof set.anchors !== 'object' || Array.isArray(set.anchors) || !Object.keys(set.anchors).length) fail('Set needs named contact anchors');
  if (!set.paths || typeof set.paths !== 'object' || Array.isArray(set.paths)) fail('Set needs named contact paths (use {} for unconnected points)');
  for (const [name, point] of Object.entries(set.anchors)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) fail(`Invalid anchor name: ${name}`);
    vector(point, `anchor ${name}`);
  }
  for (const [name, refs] of Object.entries(set.paths ?? {})) {
    if (!Array.isArray(refs) || refs.length < 2) fail(`Path ${name} needs at least two anchors`);
    refs.forEach(ref => { if (!Object.hasOwn(set.anchors, ref)) fail(`Path ${name}: missing anchor ${ref}`); });
    for (let i = 1; i < refs.length; i++) {
      if (Math.hypot(...set.anchors[refs[i]].map((v, j) => v - set.anchors[refs[i - 1]][j])) < 1e-6) fail(`Path ${name}: repeated contact at ${refs[i]}`);
    }
  }
  if (set.art) {
    if (typeof set.art.file !== 'string' || !set.art.file) fail('Set artwork needs a file');
    vector(set.art.position, 'Artwork position');
    vector(set.art.size, 'Artwork size');
    set.art.size.forEach(v => positive(v, 'Artwork size'));
  }
  if (set.occluders !== undefined) {
    if (!Array.isArray(set.occluders) || !set.art) fail('Foreground layers need an artwork and a polygon list');
    const names = new Set();
    for (const layer of set.occluders) {
      if (!layer.name || names.has(layer.name)) fail('Foreground layer names must be unique');
      names.add(layer.name);
      if (!Array.isArray(layer.points) || layer.points.length < 3) fail(`Foreground ${layer.name}: needs at least three points`);
      layer.points.forEach(p => vector(p, `Foreground ${layer.name}`));
      let sign = 0;
      for (let i = 0; i < layer.points.length; i++) {
        const a = layer.points[i], b = layer.points[(i + 1) % layer.points.length], c = layer.points[(i + 2) % layer.points.length];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cross) < 1e-7) continue;
        if (sign && Math.sign(cross) !== sign) fail(`Foreground ${layer.name}: split concave shapes into convex polygons`);
        sign = Math.sign(cross);
      }
      if (!sign) fail(`Foreground ${layer.name}: polygon has no area`);
    }
  }
  return set;
}

export function anchor(set, name) {
  if (!Object.hasOwn(set.anchors, name)) fail(`Missing contact anchor: ${name}`);
  return transformPoint(set.transform, set.anchors[name]);
}

export function contactPath(set, name) {
  if (!Object.hasOwn(set.paths, name)) fail(`Missing contact path: ${name}`);
  return set.paths[name].map(ref => anchor(set, ref));
}

// A reusable alternating-contact action. It produces targets, not joint poses.
// Foot zero moves first. The other foot remains planted throughout each step.
export function stepAction(set, options) {
  validateSet(set);
  const { path, initialFeet, secondsPerStep, liftHeight, rootOffset, liftOff = 0.12, landAt = 0.9 } = options;
  if (!Object.hasOwn(set.paths, path)) fail(`Missing contact path: ${path}`);
  if (!Array.isArray(initialFeet) || initialFeet.length !== 2) fail('A step action needs two initial foot anchors');
  if (initialFeet[0] === initialFeet[1]) fail('Initial feet must use two distinct anchors');
  initialFeet.forEach(ref => anchor(set, ref));
  positive(secondsPerStep, 'Seconds per step');
  if (!finite(liftHeight) || liftHeight < 0) fail('Lift height must be non-negative');
  vector(rootOffset, 'Root offset');
  if (!finite(liftOff) || !finite(landAt) || liftOff < 0 || landAt > 1 || liftOff >= landAt) fail('Require 0 <= liftOff < landAt <= 1');
  const targets = set.paths[path].map(ref => [...set.anchors[ref]]);
  const initial = initialFeet.map(ref => [...set.anchors[ref]]);
  const duration = targets.length * secondsPerStep;
  const rootAt = feet => feet[0].map((v, i) => (v + feet[1][i]) / 2 + rootOffset[i]);
  return {
    duration,
    at(time) {
      if (!finite(time)) fail('Action time must be finite');
      const t = clamp(time, 0, duration);
      const step = Math.min(targets.length - 1, Math.floor(t / secondsPerStep));
      const phase = Math.min(1, (t - step * secondsPerStep) / secondsPerStep);
      const feet = initial.map(p => [...p]);
      for (let i = 0; i < step; i++) feet[i % 2] = [...targets[i]];
      const moving = step % 2, from = [...feet[moving]], to = targets[step];
      const endFeet = feet.map(p => [...p]);
      endFeet[moving] = to;
      const root = lerp(rootAt(feet), rootAt(endFeet), smooth(phase));
      const p = clamp((phase - liftOff) / (landAt - liftOff), 0, 1);
      feet[moving] = lerp(from, to, smooth(p));
      feet[moving][1] -= Math.sin(p * Math.PI) * liftHeight;
      return { root: transformPoint(set.transform, root), feet: feet.map(p => transformPoint(set.transform, p)), support: 1 - moving, step, phase };
    },
  };
}

// A hand target at a fixed distance from its shoulder on a straight rail.
// Never hide an impossible contact by stretching the arm or extending the rail.
export function reachRail(shoulder, radius, start, end, towardEnd = true) {
  [shoulder, start, end].forEach(p => vector(p, 'Rail contact'));
  positive(radius, 'Arm reach');
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  positive(length, 'Rail length');
  const unit = [dx / length, dy / length];
  const along = (shoulder[0] - start[0]) * unit[0] + (shoulder[1] - start[1]) * unit[1];
  const projection = [start[0] + along * unit[0], start[1] + along * unit[1]];
  const distance = Math.hypot(shoulder[0] - projection[0], shoulder[1] - projection[1]);
  if (distance > radius + 1e-7) fail('Rail is beyond arm reach; reposition the actor or rail');
  const offset = Math.sqrt(Math.max(0, radius * radius - distance * distance));
  const candidates = [along + offset, along - offset].filter(t => t >= -1e-7 && t <= length + 1e-7);
  if (!candidates.length) fail('Hand contact is past the end of the rail');
  const t = towardEnd ? Math.max(...candidates) : Math.min(...candidates);
  return [start[0] + t * unit[0], start[1] + t * unit[1]];
}

// Place a reusable prop by its grip point, not by the centre of its artwork.
export function attachAt(socket, grip, { rotation = 0, scale = 1 } = {}) {
  vector(socket, 'Socket'); vector(grip, 'Prop grip');
  if (!finite(rotation)) fail('Prop rotation must be finite');
  positive(scale, 'Prop scale');
  const angle = rotation * Math.PI / 180, c = Math.cos(angle) * scale, s = Math.sin(angle) * scale;
  return [c, s, -s, c, socket[0] - c * grip[0] + s * grip[1], socket[1] - s * grip[0] - c * grip[1]];
}
