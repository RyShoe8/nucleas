# Nucleas integration of Rigby2D 0.5.1

Source snapshot copied from the Hyperdisc authoring checkout at `build/rigby-tool`, November 19, 2026. Original code copyrights and MIT/Apache licenses are retained. This is a modified integration, not an official Rigby2D release.

Local patches:
- `src/editor/nucleas.js`: origin/source-checked project open/save/visibility bridge; saves acknowledged by the authenticated Nucleas parent.
- `main.js`: install bridge, skip first-run tour when embedded, use Nucleas branding.
- `brandmark.js`, `whatsnewui.js`, `welcomeui.js`, `helpui.js`, `index.html`: Nucleas branding, retaining upstream credit and documentation links.
- `demos.js`: Nucleas office characters replace proprietary upstream demos.
- `nucleas-mark.svg`: local integration mark.
- Build configuration maintained in the host repository at `scripts/rigby-vite.config.mjs`.

No source changes were made in Hyperdisc. Upstream proprietary demo artwork and logo files are ignored and are not bundled. Update by reviewing these patches against a new upstream snapshot; do not replace Nucleas's generated character masters.
