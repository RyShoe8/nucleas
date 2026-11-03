const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/components/os/modules/registerModules.ts'), 'utf8');
const entries = [...source.matchAll(/id: '([^']+)',[\s\S]*?title: '([^']+)',[\s\S]*?permissions: '([^']+)',([\s\S]*?)render:/g)].map(([, id, title, permission, rest]) => ({ id, title, permission, hidden: /launcherHidden: true/.test(rest) }));
if (!entries.some(e => e.id === 'assistant')) throw new Error('Module registry format changed; update desktop catalog generation.');
fs.writeFileSync(path.join(root, 'desktop/renderer/catalog.json'), JSON.stringify(entries, null, 2));
fs.copyFileSync(path.join(root, 'public/icons/pwa-512.png'), path.join(root, 'desktop/renderer/icon.png'));
