# Animation Studio and the live office

Nucleas vendors the Rigby2D 0.5.1 source snapshot already used by Hyperdisc, under its MIT / Apache-2.0 licenses. Upstream: https://github.com/jaisurya-dev-art/rigby2d. The integrated editor is named Nucleas Animation and retains upstream attribution. Proprietary upstream demo characters and brand artwork are excluded from delivery; the demo picker uses Nucleas's own six employees.

## Use

- Open a company → Team → Creative → Animation Studio, or Tools → Animation Studio.
- Choose an office character or use File → Open for a `.rigby` work file.
- Edit the rig and its timelines. Save new version stores a new company Asset and preserves older versions. File → Save downloads a local work file; File → Export produces game/animation delivery assets.
- Company saves are limited to 3 MB, 512 archive entries and 12 MB expanded size. Larger projects can be edited and downloaded locally. Binary payloads are stored separately from Asset metadata to keep asset listings light.
- Ask's `company_animation` tool can list and inspect saved company rigs, and make bounded bone/keyframe edits into a new draft when asked. It uses the same upstream editing engine. Filesystem paths, scripts and automatic publication are not exposed to the model.

Company and organization access is checked before loading projects. The editor's message bridge accepts only its same-origin parent; the parent performs authenticated persistence. Model edits use a temporary workspace containing only the selected file, with no network, script or shell tool. Saves never automatically replace live office assets.

## Office runtime

`scripts/build-office-rigs.mjs` packs the original generated body parts into front and rear native `.rigby` sources for six employees, and samples their Rigby runtime into a shared 24 fps motion file plus WebP atlases. The office plays those sampled transforms with Canvas; it does not load the editor or call models. Walking, typing, sitting, conversation, coffee, pool, gaming and rear-facing lounge seating have separate clips, with short transitions between them. Gaming and relaxing share three couch seats; the couch back occludes the seated figures, which face the television. Pool, coffee and water support simultaneous occupants at distinct positions.

One capped building clock moves employees and draws only visible characters. Assets are shared across companies; hidden tabs, offscreen buildings and reduced-motion preferences stop the clock. Pausing Animation Studio's window stops editor playback as well. No permanent character-level timers or GIF decoders run in the floor view.

`officeSimulation.ts` defines stable company suites, aisles, doorways and amenity capacities. Owned/internal companies have larger studios; clients have smaller studios in their own wing. Recent outstanding team consultations on active jobs determine collaboration: pairs meet at a desk; groups of three or more use the conference room. Historic advice does not stage a meeting. Break-room behavior is ambient, clearly labeled, and never creates work, spending or provider calls.

Company logos and descriptions come from existing profiles. Desk labels, review badges and the work strip come from the same job/activity records as Work. Company signs and metric boards open Company; desk labels open the responsible member and focused job. Company list remains available for small screens and users who prefer a roster.

## Rebuild

```text
node scripts/build-office-activities.mjs
node scripts/build-office-architecture.mjs
node scripts/build-office-rigs.mjs
npm run animation:build
```

`npm run build` runs the animation editor build first. Generated editor bundles live in ignored `public/animation-studio/`; source, pinned dependencies and licenses live in `vendor/rigby`. The editor is lazy-loaded in its own module and never included in the normal office startup bundle. Python and speech tooling remain on-demand editor features.

`npm run animation:cli -- inspect public/office/rigs/creative.rigby` exposes the local authoring CLI. The upstream MCP entry is `vendor/rigby/src/mcp/server.js`; when using it with a worker, explicitly provide that worker's permitted project root. Nucleas currently exposes the bounded draft editing tool described above, not arbitrary MCP commands.

## Review and limits

These are articulated 2D characters with original shaded artwork, not freely rotating 3D meshes. New camera angles still require authored art. The room plates and furniture are separate from the actors so movement does not drag scenery. New art or a changed rig must be checked in the assembled scene and rebuilt before being promoted to live office assets.

Browser smoke checks use fixture companies, never production jobs. They cover company navigation, desktop/mobile floor layout, pause/resume and the editor open/save bridge, including the actual production CSP and frame headers. Twenty-four focused tests cover doorway movement, collaboration routing, bounded archives, authenticated company boundaries and real Rigby draft edits. The local production build passed; it requires network access for the existing Google font downloads.
