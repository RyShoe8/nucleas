import { put } from '@vercel/blob';
import fs from 'node:fs/promises';
if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
  throw new Error('Desktop publishing requires the GitHub Actions repository secret BLOB_READ_WRITE_TOKEN for the same Vercel Blob store used by nucleas.app. The installer artifact is available on this workflow run, but downloads and automatic updates cannot work until this secret is configured.');
}
const directory = new URL('../release/', import.meta.url);
const files = await fs.readdir(directory);
const assets = files.filter(name => /^Nucleas-Setup-\d+\.\d+\.\d+\.exe(?:\.blockmap)?$/.test(name));
if (!assets.some(name => name.endsWith('.exe')) || !files.includes('latest.yml')) throw new Error('Installer or update manifest missing.');
// Publish binaries first. The manifest is the atomic release pointer.
for (const name of [...assets, 'latest.yml']) {
  await put(`desktop/releases/windows/${name}`, await fs.readFile(new URL(name, directory)), { access: 'public', addRandomSuffix: false, allowOverwrite: name === 'latest.yml', cacheControlMaxAge: name === 'latest.yml' ? 0 : 31536000 });
}
console.log('Desktop release published.');
