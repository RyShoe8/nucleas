// Imported from Hyperdisc; browser IO adapter only. See SOURCE.json.
import { attachAt, transformPoint } from './contacts.mjs';

const pair = (v, label) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`${label} needs two finite coordinates`); };

// Three explicit ownership phases: source socket -> flight -> recipient socket.
// Endpoints are sampled from the actual performance at the release/catch times.
export function propTransfer(spec, sampleSocket) {
  const { release, catch: caught, arcHeight = 0, turns = 0 } = spec;
  if (!Number.isFinite(release) || release < 0 || !Number.isFinite(caught) || caught <= release) throw new Error('Prop catch must be later than release');
  if (!Number.isFinite(arcHeight) || arcHeight < 0 || arcHeight > 2000) throw new Error('Prop arc must be 0–2000 pixels');
  if (!Number.isInteger(turns) || Math.abs(turns) > 20) throw new Error('Prop spin needs a whole number of turns between -20 and 20');
  const grips = [spec.from.grip ?? [0, 0], spec.to.grip ?? [0, 0]];
  grips.forEach(p => pair(p, 'Prop grip'));
  const attached = (ref, grip, time) => {
    const socket = sampleSocket(ref, time); pair(socket, 'Evaluated socket');
    return { socket, point: transformPoint(attachAt(socket, grip), [0, 0]) };
  };
  const start = attached(spec.from, grips[0], release).point;
  const end = attached(spec.to, grips[1], caught).point;
  return {
    start, end,
    at(time) {
      if (!Number.isFinite(time)) throw new Error('Prop time must be finite');
      if (time < release) return { ...attached(spec.from, grips[0], time), phase: 'held', rotation: 0, grip: grips[0] };
      if (time >= caught) return { ...attached(spec.to, grips[1], time), phase: 'caught', rotation: turns * 360, grip: grips[1] };
      const p = (time - release) / (caught - release);
      return { phase: 'flight', rotation: turns * 360 * p,
        point: [start[0] + (end[0] - start[0]) * p, start[1] + (end[1] - start[1]) * p - 4 * arcHeight * p * (1 - p)] };
    },
  };
}

export function jumpPath(from, to, start, end, height) {
  pair(from, 'Jump start'); pair(to, 'Jump landing');
  if (![start, end, height].every(Number.isFinite) || start < 0 || end <= start || height <= 0) throw new Error('Jump needs ordered times and positive height');
  return time => {
    const p = Math.max(0, Math.min(1, (time - start) / (end - start)));
    return [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p - 4 * height * p * (1 - p)];
  };
}

// A targeted throw is still aimed at its intended recipient when intercepted.
// Project the blocking socket onto that lane; reject impossible staging.
export function aimedIntercept(from, aim, blocker, maximumMiss) {
  [from, aim, blocker].forEach(p => pair(p, 'Throw contact'));
  if (!Number.isFinite(maximumMiss) || maximumMiss <= 0) throw new Error('Interception tolerance must be positive');
  const dx = aim[0] - from[0], dy = aim[1] - from[1], length2 = dx * dx + dy * dy;
  if (length2 < 1) throw new Error('Throwing lane is too short');
  const fraction = ((blocker[0] - from[0]) * dx + (blocker[1] - from[1]) * dy) / length2;
  const point = [from[0] + dx * fraction, from[1] + dy * fraction];
  const miss = Math.hypot(point[0] - blocker[0], point[1] - blocker[1]);
  if (fraction <= 0 || fraction >= 1 || miss > maximumMiss) throw new Error(`Blocker misses the throwing lane (${miss.toFixed(1)} px); restage the action`);
  return { point, fraction, miss };
}
