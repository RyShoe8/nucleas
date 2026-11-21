/** General studio inputs. Examples never constrain what a project can contain. */
export function authoringOptions(input) {
  if (!input || !['animation', 'scene'].includes(input.kind)) throw Error('Choose an animation or a scene.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120) throw Error('Give the project a name of up to 120 characters.');
  for (const key of ['width', 'height', 'fps']) {
    const max = key === 'fps' ? 60 : 4096;
    if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > max) throw Error(`${key} must be a whole number from 1 to ${max}.`);
  }
  if (!Number.isFinite(input.duration) || input.duration < .1 || input.duration > 120) throw Error('Initial duration must be 0.1–120 seconds.');
  return { ...input, name };
}

/** Check dimensions before image decoding so compressed images cannot exhaust the renderer. */
export function artworkFiles(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32) throw Error('Import 1–32 PNG layers at a time.');
  let bytes = 0, pixels = 0;
  return input.map(file => {
    const data = new Uint8Array(file.bytes);
    if (!/\.png$/i.test(file.name) || /[/\\]/.test(file.name) || data.length < 24 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => data[i] === v)) throw Error('Choose PNG artwork.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const w = view.getUint32(16), h = view.getUint32(20);
    if (!w || !h || w > 8192 || h > 8192) throw Error('PNG layers must be at most 8192 pixels per side.');
    bytes += data.length; pixels += w * h;
    if (bytes > 32 * 1024 * 1024 || pixels > 32 * 1024 * 1024) throw Error('Import fewer or smaller layers (32 MB files / 32 megapixels per import).');
    return { name: file.name, bytes: data };
  });
}
