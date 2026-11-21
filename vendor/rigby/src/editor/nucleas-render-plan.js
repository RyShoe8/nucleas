import { planJobs } from './render/plan.js';
import { frameRange } from './render/offline.js';

/** CLI parameters, with explicit browser resource limits instead of an unbounded render. */
export function planBrowserRender(doc, options) {
  if (!options || typeof options.out !== 'string' || options.out.length > 180 || /[/\\:]/.test(options.out)) throw Error('Use a filename without a folder or drive path.');
  if (options.quality !== undefined && !['high', 'medium', 'low'].includes(options.quality)) throw Error('Choose high, medium or low video quality.');
  const jobs = planJobs({ name: doc.name, animations: doc.animations, skins: doc.skins.map(s => s.name), settings: doc.settings }, options);
  if (jobs.length > 32) throw Error('Render at most 32 animation/skin combinations at once.');
  let totalFrames = 0;
  for (const job of jobs) {
    const s = job.settings;
    if (!Number.isInteger(s.width) || !Number.isInteger(s.height) || !Number.isFinite(s.fps) || s.width > 4096 || s.height > 4096 || s.fps > 60) throw Error('Browser renders support up to 4096 px per side and 60 fps.');
    // Resizing an export should preserve the authored shot. Rigby's CLI keeps units/pixel
    // unchanged, which crops a fixed/camera shot at smaller resolutions. Keep that behavior
    // available explicitly; never mutate the source camera or its animation.
    if (options.preserveFraming !== false && s.frame) {
      s.frame = { ...s.frame, scale: s.frame.scale * Math.max(doc.settings.width / s.width, doc.settings.height / s.height) };
    }
    for (const key of ['start', 'end']) if (job[key] !== null && (!Number.isInteger(job[key]) || job[key] < 0)) throw Error('Frame bounds must be nonnegative integers.');
    if (job.start !== null && job.end !== null && job.end < job.start) throw Error('Last frame must follow the first frame.');
    const range = frameRange(doc, job.animation, s.fps, job.start, job.end);
    if (job.start > range.last || job.end > range.last) throw Error(`Frame range exceeds this animation (last frame ${range.last}).`);
    totalFrames += range.count;
    if (['gif', 'png'].includes(job.format) && s.width * s.height * range.count * 4 > 128 * 1024 * 1024) throw Error('This export exceeds the 128 MB frame budget. Reduce dimensions, frame rate or frame range.');
  }
  if (totalFrames > 3600) throw Error('Export at most 3,600 frames at once. Shorten the range or select fewer animations.');
  return jobs;
}
