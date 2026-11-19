import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const root = path.resolve('vendor/rigby');
const out = path.resolve('public/animation-studio');
export default defineConfig({
  root, base: '/animation-studio/',
  define: { __RIGBY_VERSION__: JSON.stringify('0.5.1 (Nucleas integration)') },
  resolve: { alias: { '@demo-sources': path.join(root, 'src/editor/demo-sources-remote.js') } },
  worker: { format: 'es' },
  plugins: [{ name: 'rigby-runtime-assets', generateBundle() {
    for (const name of ['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']) {
      this.emitFile({ type:'asset', fileName:`pyodide/${name}`, source:fs.readFileSync(path.join(root,'node_modules/pyodide',name)) });
    }
    for (const name of ['LICENSE-MIT','LICENSE-APACHE','THIRD_PARTY_NOTICES.md','TRADEMARKS.md']) {
      this.emitFile({type:'asset',fileName:name,source:fs.readFileSync(path.join(root,name))});
    }
  } }],
  build: { outDir:out, emptyOutDir:true, target:'es2021', rollupOptions:{input:path.join(root,'index.html')} },
});
