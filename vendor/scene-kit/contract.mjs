import catalog from './library/tools/art/scene-kit/catalog.json';
export { catalog };
export const SCENE_LIMITS = { x: [-2000, 2000], y: [-1000, 1000], scale: [0.5, 2], secondsPerStep: [0.2, 1.2], pace: [0.5, 1.5], arcHeight: [0, 240] };
export const SCENE_DEFAULTS = { mode: 'stairs', sequence: 'disc-pass', set: 'tower', actor: 'tiffany', action: 'descent', x: 0, y: 0, scale: 1, secondsPerStep: 0.4, pace: 1, arcHeight: 65, showContacts: false };
export function validateSceneRequest(input) {
  if (!input || !['stairs', 'sequence'].includes(input.mode)) throw Error('Choose a supported scene workflow.');
  const selected = input.mode === 'sequence' ? catalog.sequences.find(s => s.id === input.sequence) : catalog.sets.find(s => s.id === input.set);
  if (!selected) throw Error('Choose a library scene or set.');
  if (input.mode === 'stairs' && (!catalog.actors.some(a => a.id === input.actor) || !selected.actions.some(a => a.id === input.action))) throw Error('Choose a supported character and action.');
  for (const key of ['x', 'y', 'scale', ...(input.mode === 'stairs' ? ['secondsPerStep'] : ['pace', 'arcHeight'])]) {
    const [min, max] = SCENE_LIMITS[key];
    if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw Error(`${key} must be ${min}–${max}.`);
  }
  return input;
}

/** Bound expansion before Rigby's ZIP reader, also for local browser imports. */
export function checkLocalProject(bytes, maxBytes = 64 * 1024 * 1024) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > maxBytes) throw Error(`Choose a Rigby project smaller than ${maxBytes / 1024 / 1024} MB.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw Error('Not a Rigby project archive.');
  const count = view.getUint16(end + 10, true);
  if (!count || count > 2048) throw Error('Too many project attachments.');
  let p = view.getUint32(end + 16, true), expanded = 0;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50) throw Error('Invalid archive directory.');
    expanded += view.getUint32(p + 24, true);
    if (expanded > 96 * 1024 * 1024) throw Error('Expanded project exceeds 96 MB.');
    const n = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    if (p + 46 + n + extra + comment > end) throw Error('Invalid archive entry.');
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n));
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || name.split('/').includes('..') || names.has(name)) throw Error('Invalid project attachment path.');
    names.add(name); p += 46 + n + extra + comment;
  }
}
