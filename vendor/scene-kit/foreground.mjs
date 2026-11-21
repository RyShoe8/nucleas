// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
// One set definition supplies foreground geometry for every interaction type.
// Append after performers/props so they pass behind the painted near surfaces.
export function appendForeground(stage, set) {
  for (const layer of set.occluders ?? []) {
    const points = layer.points, [x, y] = set.art.position, [w, h] = set.art.size;
    const mesh = { name: layer.name, type: 'mesh', image: 'backdrop', width: w, height: h, hull: points.length,
      uvs: points.flatMap(p => [(p[0] - x) / w, (p[1] - y) / h]),
      weights: points.map(p => [{ bone: 1, x: p[0], y: -p[1], weight: 1 }]), triangles: [] };
    for (let i = 1; i < points.length - 1; i++) mesh.triangles.push(0, i, i + 1);
    stage.slots.push({ name: `foreground/${layer.name}`, bone: 1, color: [1, 1, 1, 1], attachment: layer.name, attachments: [mesh] });
  }
}
