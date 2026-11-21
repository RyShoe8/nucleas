// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
import { memoryFiles as fs, bytesOf } from './memory-files.mjs';
import { memoryPath as path } from './memory-files.mjs';

// Socket data belongs to the character. No scene contains guessed wrist offsets.
export function loadPerformance(file, rigby) {
  const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (binding.format !== 'rigby-performance-binding/1') throw new Error('Expected rigby-performance-binding/1');
  const source = path.resolve(path.dirname(file), binding.source);
  const files = rigby.unzip(fs.readFileSync(source));
  if (!files.has('project.json')) throw new Error(`Missing character project: ${source}`);
  const doc = JSON.parse(new TextDecoder().decode(files.get('project.json')));
  const sk = rigby.Skeleton.fromJson(JSON.stringify(doc));
  const metadata = JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), binding.metadata), 'utf8'));
  return { binding, source, files, doc, sk, metadata };
}

export function socketPoint(actor, pose, name) {
  const socket = actor.binding.sockets[name];
  if (!socket) throw new Error(`${actor.binding.name}: unknown socket ${name}`);
  const slot = actor.sk.slots.findIndex(s => s.name === socket.atlasSlot);
  const attachment = slot >= 0 ? pose.attachment[slot] : null;
  let matrix, local;
  if (attachment) {
    const match = /^frame-(\d+)$/.exec(attachment);
    const point = match ? actor.metadata.frames[Number(match[1])]?.[socket.marker] : socket.attachments?.[attachment];
    if (!point) throw new Error(`${actor.binding.name}/${name}: no authored socket for ${attachment}`);
    const [x, y] = point, [ax, ay] = actor.metadata.anchor, offset = socket.atlasOffset ?? [0, 0];
    local = [x - ax + offset[0], ay - y - offset[1]];
    matrix = pose.world[actor.sk.slots[slot].bone];
  } else {
    const active = Object.entries(socket.meshAttachments ?? {}).some(([name, attachments]) => {
      const index = actor.sk.slots.findIndex(slot => slot.name === name);
      return index >= 0 && attachments.includes(pose.attachment[index]);
    });
    const variant = (socket.variants ?? []).find(v => {
      const index = actor.sk.slots.findIndex(slot => slot.name === v.slot);
      return index >= 0 && pose.attachment[index] === v.attachment;
    });
    const bone = actor.sk.boneIndex(variant?.bone ?? socket.bone);
    if ((!active && !variant) || bone < 0) throw new Error(`${actor.binding.name}/${name}: active performance has no socket binding`);
    matrix = pose.world[bone];
    const offset = variant?.offset ?? socket.boneOffset ?? [0, 0]; local = [offset[0], -offset[1]];
  }
  return [matrix.a * local[0] + matrix.c * local[1] + matrix.tx,
    -(matrix.b * local[0] + matrix.d * local[1] + matrix.ty)];
}
