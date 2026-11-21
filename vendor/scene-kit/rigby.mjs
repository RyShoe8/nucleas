// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
import { memoryFiles as fs, bytesOf } from './memory-files.mjs';
import { memoryPath as path } from './memory-files.mjs';


import { inverse, transformPoint, validateSet } from './contacts.mjs';



const bone = (name, parent, x = 0, y = 0) => ({ name, ...(parent === null ? {} : { parent }), x, y, rotation: 0, scale_x: 1, scale_y: 1, length: 0 });

// Rigby matrices are Y up; contact documents and Godot stage coordinates are Y down.
const downMatrix = m => [m.a, -m.b, -m.c, m.d, m.tx, -m.ty];
function matrixBone(name, parent, [a, b, c, d, x, y]) {
  return { ...bone(name, parent, x, -y), scale_x: Math.hypot(a, b), scale_y: Math.hypot(c, d),
    shear_x: Math.atan2(-b, a) * 180 / Math.PI, shear_y: Math.atan2(d, -c) * 180 / Math.PI - 90 };
}

// Code-drawn editor handles; no new character/set art and no raster dependency.
function markerPng(_crc32, solid = false) { return fs.readFileSync(solid ? '/guide.png' : '/contact.png'); }

export function makeContactProject(set, rigby, artBytes) {
  validateSet(set);
  const doc = { format: 'rigby-snapshot/1', name: `${set.name} — contacts`, workspace: 'film', textureFilter: 'nearest',
    bones: [bone('root', null), matrixBone('set', 0, set.transform)], slots: [], images: [],
    animations: [{ name: 'contacts', duration: 1, bones: [], slots: [] }] };
  const points = Object.values(set.anchors).map(p => transformPoint(set.transform, p));
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  doc.settings = { width: 1280, height: 720, fps: 30, background: [0.04, 0.05, 0.07, 1],
    frame: { x: (left + right) / 2, y: -(top + bottom) / 2, scale: Math.max((right - left + 180) / 1280, (bottom - top + 180) / 720, 0.1), camera: false } };
  const files = [], contactBones = {};
  if (set.art) {
    if (!artBytes?.length) throw new Error('Missing set artwork bytes');
    const [w, h] = set.art.size, [x, y] = set.art.position;
    const imageName = `backdrop${path.extname(set.art.file) || '.png'}`;
    doc.bones.push(bone('backdrop', 1, x, -y));
    doc.images.push({ name: 'backdrop', width: w, height: h, path: `images/${imageName}` });
    doc.slots.push({ name: 'backdrop', bone: 2, color: [1, 1, 1, 1], attachment: 'backdrop', attachments: [{ name: 'backdrop', width: w, height: h, x: w / 2, y: -h / 2, rotation: 0, scale_x: 1, scale_y: 1 }] });
    files.push({ path: `images/${imageName}`, bytes: artBytes });
  }
  doc.images.push({ name: 'contact', width: 25, height: 25 });
  files.push({ path: 'images/contact.png', bytes: markerPng(rigby.crc32) });
  for (const [name, [x, y]] of Object.entries(set.anchors)) {
    const n = doc.bones.length;
    contactBones[name] = n;
    doc.bones.push({ ...bone(`contact/${name}`, 1, x, -y), color: name.startsWith('rail') ? 'ffbd52ff' : '38bdf8ff' });
    doc.slots.push({ name, bone: n, color: name.startsWith('rail') ? [1, 0.74, 0.32, 1] : [0.22, 0.74, 0.97, 1], attachment: 'contact',
      attachments: [{ name: 'contact', width: 25, height: 25, x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1 }] });
  }
  // Weighted guide strips keep connections attached when points move in Rigby's
  // Setup editor. No plugin or separate viewport solver is required.
  doc.images.push({ name: 'guide', width: 25, height: 25 });
  files.push({ path: 'images/guide.png', bytes: markerPng(rigby.crc32, true) });
  const guides = [];
  for (const [name, refs] of Object.entries(set.paths)) for (let i = 1; i < refs.length; i++) {
    const [a, b] = refs.slice(i - 1, i + 1).map(ref => set.anchors[ref]);
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    const nx = -dy / length * 1.5, ny = dx / length * 1.5;
    const weight = (ref, sign) => [{ bone: contactBones[ref], x: nx * sign, y: -ny * sign, weight: 1 }];
    const mesh = { name: `guide/${name}/${i}`, type: 'mesh', image: 'guide', width: 25, height: 25,
      uvs: [0, 0, 0, 1, 1, 0, 1, 1], triangles: [0, 1, 2, 2, 1, 3], hull: 4,
      weights: [weight(refs[i - 1], 1), weight(refs[i - 1], -1), weight(refs[i], 1), weight(refs[i], -1)] };
    guides.push({ name: mesh.name, bone: 1, color: name.includes('rail') ? [1, 0.74, 0.32, 0.9] : [0.22, 0.74, 0.97, 0.9], attachment: mesh.name, attachments: [mesh] });
  }
  doc.slots.splice(set.art ? 1 : 0, 0, ...guides);
  const sk = rigby.Skeleton.fromJson(JSON.stringify(doc)), error = sk.validate();
  if (error) throw new Error(error);
  files.push({ path: 'project.json', bytes: bytesOf(JSON.stringify(doc, null, 2)) });
  return { doc, bytes: rigby.zip(files, new Date(2020, 0, 1)) };
}

export function readContactProject(template, bytes, rigby) {
  validateSet(template);
  const files = rigby.unzip(bytes);
  const data = files.get('project.json');
  if (!data) throw new Error('Contact project has no project.json');
  const sk = rigby.Skeleton.fromJson(new TextDecoder().decode(data));
  const error = sk.validate();
  if (error) throw new Error(error);
  // Contacts are edited in Setup. Reject animation keys rather than silently
  // importing the wrong frame and giving the author a misleading result.
  if (sk.animations.some(a => a.bones?.length || a.slots?.length || a.ik?.length || a.deform?.length)) throw new Error('Edit contact points in Setup mode; animated contact projects are not supported');
  const pose = new rigby.Pose(sk); pose.reset(sk); pose.updateWorld(sk);
  const index = name => {
    const matches = sk.bones.map((b, i) => b.name === name ? i : -1).filter(i => i >= 0);
    if (matches.length !== 1) throw new Error(`Contact project needs exactly one bone named ${name}`);
    return matches[0];
  };
  const result = structuredClone(template);
  result.transform = downMatrix(pose.world[index('set')]);
  const toLocal = inverse(result.transform);
  for (const name of Object.keys(template.anchors)) {
    const m = pose.world[index(`contact/${name}`)];
    result.anchors[name] = transformPoint(toLocal, [m.tx, -m.ty]);
  }
  if (template.art) {
    const m = pose.world[index('backdrop')];
    const p = transformPoint(toLocal, [m.tx, -m.ty]);
    const localX = transformPoint(toLocal, [m.tx + m.a, -m.ty - m.b]);
    const localY = transformPoint(toLocal, [m.tx - m.c, -m.ty + m.d]);
    if (Math.hypot(localX[0] - p[0] - 1, localX[1] - p[1], localY[0] - p[0], localY[1] - p[1] - 1) > 1e-6) throw new Error('Move/scale the set bone to transform artwork and contacts together; do not scale or rotate backdrop alone');
    result.art.position = p;
  }
  return validateSet(result);
}

export function loadSet(file) {
  return validateSet(JSON.parse(fs.readFileSync(file, 'utf8')));
}
