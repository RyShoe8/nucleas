# Animation Studio and the live office

Nucleas vendors the Rigby2D 0.5.1 source snapshot already used by Hyperdisc, under its MIT / Apache-2.0 licenses. Upstream: https://github.com/jaisurya-dev-art/rigby2d. The integrated editor is named Nucleas Animation and retains upstream attribution. Proprietary upstream demo characters and brand artwork are excluded from delivery; the demo picker uses Nucleas's own six employees.

## Use

- Open a company → Team → Creative → Animation Studio, or Tools → Animation Studio.
- **Create** starts a named blank animation or a scene with camera and actor tracks. Set dimensions, frame rate and initial duration. Any artwork, brand or character can be used; there is no fixed action vocabulary.
- **Files & sources** imports `.rigby` projects, PNG layers and reusable `.rigby` actors, opens saved company versions and office characters, and prepares downloadable source files. The native File menu also supports PSD, SVG, Aseprite and skeleton imports.
- **Edit** gives the full canvas, Setup/Animate modes, layers, bones, constraints, undo/redo, keyframes, curves and multi-actor clip tracks. These are the same Rigby editor and runtime used by Hyperdisc.
- **Export** renders the open project to animated GIF, MP4, WebM or PNG frames, with immediate GIF/video preview and a download. Options follow Rigby's native render planner: animation/all animations, skin/all skins, dimensions, FPS, project/transparent/custom RGBA background, video quality and inclusive frame ranges. Multi-file results are ZIPs. GIF loops, has no audio, supports one-bit transparency and uses a minimum 20 ms frame delay; MP4 cannot preserve transparency. Video export requires WebCodecs support.
- **Examples** contains the optional Hyperdisc scene kit: stair descent (Tiffany/Mick), disc pass and jump catch. It compiles the original motion, contact, IK and socket calculations into native editable scenes. Offset, scale, step timing, sequence pace, arc height, guides and edited contact rigs match the source builder. New arbitrary actions are authored in the main editor; these presets are not a general natural-language motion generator.
- **Save version** stores a new company Asset and preserves older versions. Company → Library → Assets → **Edit in Animation Studio** reopens an editable source directly. File → Save or Prepare project download keeps a local work file; saving does not publish artwork or replace live office/game assets.
- Company source versions now use private Rogly storage and support up to 64 MB, 2,048 archive entries and 96 MB expanded size. Asset metadata stays in Mongo; old Mongo payloads remain readable. The legacy raw-body endpoint and bounded AI editing path retain their previous 3 MB request limits.
- Ask's `company_animation` tool can list and inspect saved company rigs, and make bounded bone/keyframe edits into a new draft when asked. It uses the same upstream editing engine. Filesystem paths, scripts and automatic publication are not exposed to the model.

Company and organization access is checked before loading projects. The editor's message bridge accepts only its same-origin parent; the parent performs authenticated persistence. Model edits use a temporary workspace containing only the selected file, with no network, script or shell tool. Saves never automatically replace live office assets.

## Rogly company source storage

PlayBound's game archive uses private Ceph S3 at `https://s3.rogly.net`, region `us-east-1`, with path-style URLs. Nucleas reuses the existing **`playbound` bucket**, with a separate **`nucleas/creative/` prefix**. The creative API cannot address game keys or other prefixes.

No new key or environment-variable setup is needed. Nucleas signs requests with its existing PlayBound website connection; PlayBound's `/api/integrations/nucleas/creative-storage` endpoint verifies the same HMAC protocol as its roundup endpoint and uses its existing game-storage S3 configuration. S3 credentials stay on PlayBound's server. The legacy roundup connection is also supported, only for the organization owning PlayBound; a disabled or unverified explicit connection cannot fall back to it. **Animation Studio → Rogly creative storage** shows connection status without asking for credentials.

Deploy the PlayBound endpoint and Nucleas changes together. The first upload merges a named CORS rule for the three production Nucleas origins and a one-day expiry restricted to `nucleas/creative/staging/`, preserving existing game archive rules. It does not create or expose a bucket. Development/preview origins are intentionally excluded. The existing storage access must permit these configuration operations; failures are reported rather than silently changing game permissions. No deployment secrets were read or copied during implementation.

Uploads use 10-minute signed PUT URLs restricted to `nucleas/creative/staging/<organization>/<company>/<version>.rigby`, with the exact content length signed. Completion is bound to the authenticated user/company/organization and a short-lived upload record. The server streams a bounded read, checks SHA-256 and archive structure, then conditionally copies the verified ETag into `nucleas/creative/organizations/<organization>/companies/<company>/animations/<version>/project.rigby`. Reusing an upload URL cannot overwrite an accepted source. Only then is the canonical Asset created. Completion retries return the same version, and failed validation creates no Asset. Staging cleanup has an independent bucket lifecycle fallback.

Readers first pass the existing company authorization check, then receive a five-minute signed GET URL; server-side tools also verify source integrity. Source bytes remain in Rogly and Mongo stores only the key, digest, byte count and canonical Asset. Existing Mongo sources are preserved, not destructively migrated. Server-generated new versions use Rogly once connected. Client-side exports remain available as downloads; this change specifically relocates editable source storage.

The S3 implementation follows AWS's [conditional-copy semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html) and [browser CORS configuration](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/cors.html). Tests use synthetic credentials, in-memory Mongo and a fake provider. PlayBound tests cover HMAC validation, exact prefixes, signed upload limits and preservation of existing CORS/lifecycle rules. Local tests and browser fixtures do not verify or modify live Ceph storage; a real save after both deployments verifies that path.

## Human editing as a workflow requirement

Creative work should retain an editable source alongside each rendered deliverable. A review flow must open the relevant editor at that source, preserve previous versions, provide an accurate preview, and keep saving a draft distinct from approving or publishing it. Do not reduce a layered animation, design or video to an uneditable flattened file as its only result.

The animation source is the `.rigby` Asset; generated GIF/video/frame files are exports. `src/lib/creative/editors.ts` resolves supported source assets to an editor and a company-scoped payload. Animation is its first supported format. Future image, document, video and other editors should add their own source contracts and controls; they are not implemented by this change. Automated workflows can supply the saved source asset ID to the same studio instead of a separate limited editing UI.

## Runtime and browser limits

Exports default to preserving the authored camera composition when dimensions change; the frame scale adjusts without changing the source. A different aspect ratio expands the view to keep the whole composition. Turn off **Keep composition when resizing** to retain the CLI's original units-per-pixel behavior instead.

The editor loads only when opened. Hyperdisc assets are fetched only when building an example; only the selected actors are downloaded. Scene compilation and GIF palette encoding run in dedicated workers, which terminate on completion or cancellation. Hiding the iframe or browser cancels active work and stops the editor frame loop and audio; closing releases the iframe and preview URLs. Rendering pauses the ordinary editor draw loop and locks editing until completion.

Local projects are limited to 64 MB / 96 MB expanded / 2,048 entries. Contact uploads are limited to 12 MB. PNG imports check dimensions before decoding and accept at most 32 layers, 32 MB of files and 32 megapixels per import. Browser exports cap each side at 4,096 px, FPS at 60, frame buffers at 128 MB for GIF/PNG, total output at 128 MB, and the batch at 32 animation/skin combinations / 3,600 frames. These are browser guardrails, not limitations of the underlying CLI. For larger exports reduce the range/resolution or use the CLI on the downloaded source.

Studio controls stack on small screens; the detailed Rigby workspace can be scrolled horizontally. Fine timeline work is best on a wide viewport. Company source storage uses direct browser-to-Rogly uploads, so 64 MB source files do not cross Vercel’s request-body limit or Mongo’s document-size limit. Larger work must be split into scenes or downloaded locally.

## Scene-kit provenance and synchronization

`vendor/scene-kit/SOURCE.json` records hashes of the exact Hyperdisc working-tree files imported on 2026-11-21. `scripts/sync-hyperdisc-animation.mjs <hyperdisc-repo>` explicitly copies only the required owned assets and compiler modules and never modifies the Hyperdisc repository. The port replaces Node filesystem/path/Buffer access with a worker-local virtual filesystem, and stores the original compiler's PNG contact handles; it does not rewrite choreography math. Review any upstream change before reimporting. The source Hyperdisc tree contained uncommitted choreography at import time, so the hashes, not a repository HEAD alone, identify this snapshot.

The Vite build publishes the pinned library under `/animation-studio/scene-library/`. Normal Nucleas builds do not require a Hyperdisc checkout, local animation server, ffmpeg installation or new credentials.

Validation: `src/lib/animation/studio.test.ts` exercises arbitrary authoring inputs, PNG allocation limits, render options, archive validation, both stair actors, both prop sequences and contact round trips. Real native-runtime prop attachment errors must stay below 0.1 px. `rigbyProject.test.ts` continues to cover existing company-source boundaries. Local browser checks exercise the actual editor/worker bundle with fixture companies; they do not write production assets.

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
