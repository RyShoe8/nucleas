import { unzip } from '../../../vendor/rigby/src/editor/zip.js';
import { Skeleton } from '../../../vendor/rigby/src/core/model.js';

export const RIGBY_MAX_BYTES = 3 * 1024 * 1024;
export const RIGBY_TAG = 'nucleas:rigby';

/** Bound archive expansion before passing it to the upstream parser. Nothing is extracted to disk. */
export function inspectRigby(bytes: Uint8Array) {
  if (bytes.length<22 || bytes.length > RIGBY_MAX_BYTES) throw new Error('Choose a valid animation project up to 3 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('Not a Rigby project archive.');
  const count = view.getUint16(end + 10, true);
  if (!count || count > 512) throw new Error('Too many animation attachments.');
  let offset = view.getUint32(end + 16, true), total = 0;
  const paths = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid archive directory.');
    total += view.getUint32(offset + 24, true);
    if (total > 12 * 1024 * 1024) throw new Error('Expanded animation project is too large.');
    const size = view.getUint16(offset + 28, true);
    const path = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + size));
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || paths.has(path)) throw new Error('Invalid archive attachment path.');
    paths.add(path);
    offset += 46 + size + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  const files = unzip(bytes) as Map<string, Uint8Array>;
  const raw = files.get('project.json');
  if (!raw || raw.length > 1024 * 1024) throw new Error('A bounded project.json is required.');
  const project = JSON.parse(new TextDecoder().decode(raw));
  if (project?.format !== 'rigby-snapshot/1' || !Array.isArray(project.bones) || !Array.isArray(project.animations) || !Array.isArray(project.slots)) throw new Error('Unsupported Rigby project structure.');
  if (project.bones.length > 1024 || project.animations.length > 128) throw new Error('Project exceeds animation complexity limits.');
  Skeleton.fromJson(new TextDecoder().decode(raw));
  return { name: typeof project.name === 'string' ? project.name.slice(0, 180) : 'Animation', bones: project.bones.length, slots: project.slots.length,
    animations: project.animations.map((clip: {name?:string; duration?:number}) => ({name:String(clip.name??'').slice(0,100),duration:clip.duration??0})),
    bytes:bytes.length };
}
