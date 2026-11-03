const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../release');
const metadata = fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8');
const filename = /^path: (.+)$/m.exec(metadata)?.[1].trim();
const expected = /^sha512: (.+)$/m.exec(metadata)?.[1].trim();
if (!filename || !/^Nucleas-Setup-\d+\.\d+\.\d+\.exe$/.test(filename) || !expected) throw new Error('Invalid release metadata.');
const hash = crypto.createHash('sha512');
const stream = fs.createReadStream(path.join(directory, filename));
stream.on('data', chunk => hash.update(chunk));
stream.on('error', error => { throw error; });
stream.on('end', () => {
  if (hash.digest('base64') !== expected) throw new Error('Installer checksum does not match updater metadata.');
  if (!fs.existsSync(path.join(directory, `${filename}.blockmap`))) throw new Error('Missing differential update blockmap.');
  console.log(`Verified installer, SHA-512 metadata and blockmap: ${filename}`);
});
