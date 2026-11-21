import { Skeleton } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { ScenePlayer } from '../core/scene.js';
import * as archive from './zip.js';
import library from '../../../scene-kit/library-files.json';
import { buildScene } from '../../../scene-kit/build.mjs';
import { memoryFiles, clearFiles } from '../../../scene-kit/memory-files.mjs';
import { validateSceneRequest } from '../../../scene-kit/contract.mjs';

self.onmessage = async ({ data }) => {
  try {
    const input = validateSceneRequest(data.input);
    const names = data.contactsOnly ? [] : input.mode === 'stairs' ? [input.actor] : input.sequence === 'disc-pass' ? ['keno', 'mick'] : ['mick', 'tango'];
    const needed = library.filter(file => !file.endsWith('.rigby') || names.some(name => file.endsWith(`/${name}.rigby`)));
    // Download the selected cast only, on demand. No local server or remote credentials.
    let done = 0;
    for (const file of needed) {
      const response = await fetch(`/animation-studio/scene-library/${file}`);
      if (!response.ok) throw Error('Scene library is unavailable. Reload after the deployment finishes.');
      memoryFiles.writeFileSync('/' + file, new Uint8Array(await response.arrayBuffer()));
      self.postMessage({ type: 'progress', message: `Loading scene assets · ${++done}/${needed.length}` });
    }
    self.postMessage({ type: 'progress', message: 'Solving character contacts and prop motion…' });
    const result = buildScene(input, { Skeleton, Pose, ScenePlayer, ...archive }, data.contacts ? new Uint8Array(data.contacts) : null, data.contactsOnly);
    self.postMessage({ type: 'result', bytes: result.bytes.buffer, report: result.report ?? null }, [result.bytes.buffer]);
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  finally { clearFiles(); self.close(); }
};
