import { catalog, validateSceneRequest, checkLocalProject } from './contract.mjs';
import { memoryFiles as fs, memoryPath as path } from './memory-files.mjs';
import { loadSet, makeContactProject, readContactProject } from './rigby.mjs';
import { compileSceneFile } from './scene.mjs';
import { compileSequenceFile } from './sequence.mjs';
const here = '/tools/art/scene-kit';
export function buildScene(input, rigby, contacts, contactsOnly = false) {
  validateSceneRequest(input);
  const sequence = input.mode === 'sequence' ? catalog.sequences.find(s => s.id === input.sequence) : null;
  const selected = catalog.sets.find(s => s.id === input.set);
  const sourceSet = path.resolve(here, sequence ? sequence.set : selected.file);
  let set = loadSet(sourceSet);
  if (contacts) { checkLocalProject(contacts, 12 * 1024 * 1024); set = readContactProject(set, contacts, rigby); }
  set.art.file = path.resolve(path.dirname(sourceSet), set.art.file);
  if (contactsOnly) return makeContactProject(set, rigby, fs.readFileSync(set.art.file));
  set.transform = set.transform.map((v, i) => v * input.scale + (i === 4 ? input.x : i === 5 ? input.y : 0));
  if (sequence) return compileSequenceFile(path.resolve(here, sequence.file), rigby, { set, speed: input.pace, arcHeight: input.arcHeight, showContacts: input.showContacts === true });
  const actor = catalog.actors.find(a => a.id === input.actor);
  fs.writeFileSync('/build/contacts.json', JSON.stringify(set));
  fs.writeFileSync('/build/scene.json', JSON.stringify({ format: 'rigby-interaction-scene/1', set: '/build/contacts.json', actor: path.resolve(here, actor.file), action: input.action, secondsPerStep: input.secondsPerStep, showContacts: input.showContacts === true }));
  return compileSceneFile('/build/scene.json', rigby);
}
