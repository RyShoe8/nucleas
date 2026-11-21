// Worker-local virtual files. No filesystem, shell, credentials or arbitrary URLs.
const files = new Map();
export const bytesOf = value => typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
function resolve(...parts) {
  const result = [];
  for (const part of parts) {
    if (part.startsWith('/')) result.length = 0;
    for (const segment of part.split('/')) {
      if (segment === '..') { if (!result.length) throw Error('Path outside animation library'); result.pop(); }
      else if (segment && segment !== '.') result.push(segment);
    }
  }
  return '/' + result.join('/');
}
export const memoryPath = { resolve, dirname: p => resolve(p).replace(/\/[^/]*$/, '') || '/', extname: p => /\.[^/.]+$/.exec(p)?.[0] ?? '' };
export const memoryFiles = {
  readFileSync(file, encoding) {
    const bytes = files.get(resolve(file));
    if (!bytes) throw Error(`Missing approved library file: ${file}`);
    return encoding ? new TextDecoder().decode(bytes) : bytes;
  },
  writeFileSync(file, value) { files.set(resolve(file), bytesOf(value)); },
};
export function clearFiles() { files.clear(); }
