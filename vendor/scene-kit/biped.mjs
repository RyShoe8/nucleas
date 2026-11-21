// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
// Build a separate interaction rig from an existing pixel mesh and authored
// anatomical pins. Standing/gameplay rigs and source artwork remain unchanged.
export function buildPinnedBiped(source, config, rigby) {
  const sk = rigby.Skeleton.fromJson(JSON.stringify(source)), pose = new rigby.Pose(sk);
  const original = sk.slots.flatMap(s => s.attachments).find(a => a.name === config.mesh);
  if (!original?.weights) throw new Error(`Missing source mesh ${config.mesh}`);
  const pts = config.pins, origin = config.origin;
  for (const name of ['front_hip', 'front_knee', 'front_ankle', 'back_hip', 'back_knee', 'back_ankle', 'shoulder', 'elbow', 'palm']) {
    if (!Array.isArray(pts[name]) || pts[name].length !== 2 || !pts[name].every(Number.isFinite)) throw new Error(`Missing anatomical pin ${name}`);
  }
  const rest = Object.fromEntries(Object.entries(pts).map(([name, p]) => [name, [p[0] - origin[0], origin[1] - p[1]]]));
  rest.root = [0, 0];
  const bones = [{ name: 'root', x: 0, y: 0, length: 0 }], indices = { root: 0 }, angles = { root: 0 }, ik = [];
  const angle = (a, b) => Math.atan2(rest[b][1] - rest[a][1], rest[b][0] - rest[a][0]) * 180 / Math.PI;
  const length = (a, b) => Math.hypot(rest[b][0] - rest[a][0], rest[b][1] - rest[a][1]);
  const add = (name, parent, rotation = 0, size = 0) => {
    const p = rest[name], o = rest[parent], a = angles[parent] * Math.PI / 180, dx = p[0] - o[0], dy = p[1] - o[1];
    indices[name] = bones.length; angles[name] = rotation;
    bones.push({ name, parent: indices[parent], x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a),
      rotation: rotation - angles[parent], length: size });
  };
  const chains = [
    ['front_hip', 'front_knee', 'front_ankle'], ['back_hip', 'back_knee', 'back_ankle'], ['shoulder', 'elbow', 'palm'],
  ];
  for (const [a, b, c] of chains) {
    add(a, 'root', angle(a, b), length(a, b)); add(b, a, angle(b, c), length(b, c)); add(c, 'root');
    ik.push({ name: `contact_${a}`, bones: [indices[a], indices[b]], target: indices[c], mix: 1,
      bendPositive: config.bendPositive?.[a] ?? false, stretch: false, compress: false });
  }
  const segmentDistance = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const verts = original.weights.map(weights => weights.reduce((p, w) => {
    const m = pose.world[w.bone];
    return [p[0] + (m.a * w.x + m.c * w.y + m.tx) * w.weight, p[1] + (m.b * w.x + m.d * w.y + m.ty) * w.weight];
  }, [0, 0]));
  const choose = p => {
    const pixel = [p[0] + origin[0], origin[1] - p[1]];
    const legTop = Math.min(pts.front_hip[1], pts.back_hip[1]);
    if (pixel[1] > legTop) {
      const side = segmentDistance(p, rest.front_hip, rest.front_ankle) < segmentDistance(p, rest.back_hip, rest.back_ankle) ? 'front' : 'back';
      if (pixel[1] >= config.shoeTop) return [[`${side}_ankle`, 1]];
      const candidates = ['front_hip', 'front_knee', 'back_hip', 'back_knee'].map(name => {
        const end = name.endsWith('hip') ? name.replace('hip', 'knee') : name.replace('knee', 'ankle');
        return [name, 1 / (2 + segmentDistance(p, rest[name], rest[end])) ** 6];
      }).sort((a, b) => b[1] - a[1]).slice(0, 2);
      const sum = candidates.reduce((s, x) => s + x[1], 0), mix = Math.min(1, (pixel[1] - legTop) / 12);
      return candidates.map(([name, w]) => [name, w / sum * mix]).concat(mix < 1 ? [['root', 1 - mix]] : []);
    }
    if (pixel[0] > config.armRegion.minX && pixel[1] >= config.armRegion.minY && pixel[1] <= config.armRegion.maxY) {
      const a = segmentDistance(p, rest.shoulder, rest.elbow), b = segmentDistance(p, rest.elbow, rest.palm);
      const mix = Math.min(1, (pixel[0] - config.armRegion.minX) / 10);
      const upper = 1 / (2 + a) ** 5, lower = 1 / (2 + b) ** 5;
      return [['shoulder', upper / (upper + lower) * mix], ['elbow', lower / (upper + lower) * mix], ['root', 1 - mix]];
    }
    return [['root', 1]];
  };
  const mesh = { ...structuredClone(original), name: 'interaction', weights: verts.map(p => choose(p).filter(([, w]) => w > 0).map(([name, weight]) => {
    const o = rest[name], a = angles[name] * Math.PI / 180, x = p[0] - o[0], y = p[1] - o[1];
    return { bone: indices[name], x: x * Math.cos(a) + y * Math.sin(a), y: -x * Math.sin(a) + y * Math.cos(a), weight };
  })) };
  return { format: 'rigby-snapshot/1', name: config.name, textureFilter: 'nearest', workspace: 'film', bones, ik,
    images: structuredClone(source.images), slots: [{ name: 'interaction', bone: 0, attachment: 'interaction', color: [1, 1, 1, 1], attachments: [mesh] }], animations: [] };
}
