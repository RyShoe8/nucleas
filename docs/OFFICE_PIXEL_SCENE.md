# Living office scene

The office keeps its compact shared layout and organization-wide employee positions. The renderer loads independent transparent WebP object images, cached floor materials and 80 × 136 directional character frames. It no longer loads the Rigby texture set for this view; Rigby remains available to the animation tools. Company identity, names and appearances are unchanged.

Saved company/project `colorPalette` colors drive wall accents, rugs and chair fabric. A selected company color is the fallback. Standard setup blue/gray values without a palette are treated as unknown branding; those areas receive stable varied neutral finishes. The Nucleas UI accent remains green.

Desks face four directions. The desk, chair, seated pose and exit route use the same orientation. Waiting for review does not prevent ambient movement. Active work takes priority even when the same employee has other results awaiting review. Human employees remain in Management; ambient breaks do not claim real human activity.

Workstations have three columns in company/Management areas and two in smaller client areas. Row heights accommodate staff and leave separate, spaced display bays. Decorative computer desks and empty-room chair pairs are removed; workstations belong to actual employees. Notice boards are projected on rear walls, never placed as floor sprites. Conference chairs are independent props, sorted with people and the table; the near row faces the table and draws in front of it. Names draw after furniture, with compact first names at overview zoom and full names on selection/close-up. Characters have sculpted silhouettes, shaded faces and clothing, six hairstyles and outfits, directional accessories, eight walking phases with articulated limbs, and lowered seated poses. Layout upgrades reset positions while retaining shared games and explicit visits.

Management exposes administrator-only Add employee and individual Remove employee controls. Creation uses the existing Employee API, invitation and seat-limit handling. An optional email explicitly sends an invitation; blank adds a roster entry only. Removal is organization-scoped and transactional: protects self/owner, expires pending invitations, detaches the user's organization membership, retains their projects under the organization owner, and clears virtual-employee reviewer assignments so owner fallback applies. Jobs and virtual employees remain. Shared-scene invalidation increments revision to prevent concurrent refreshes restoring removed desks. No new roster model is introduced.

## Interactions

- Pool: tap to aim or use the angle slider, choose power, shoot, and reset the rack. Eight object balls, cushion collisions, pockets and cue-ball respotting. This is a shared practice table, not regulation eight-ball scoring. The server simulates bounded deterministic shots; clients animate the same initial conditions. No physics ticks are written to MongoDB. Two virtual players can use this same table between human sessions.
- TV: shared six-pair memory game, power toggle and new-game control. Reveals, matches and turn count persist for the organization.
- Coffee, water, plants and reception: shared interactions with short visual feedback. The projector cycles real visible office counts. Employees can still be invited to shared objects, subject to capacity and active work.
- Commands are authenticated, organization-scoped and revision-checked. Stale game actions refresh the view and require a retry rather than overwriting another player.

The canvas runs at 20 fps during walking and 12 fps during ambient actions, only while animated and visible. Pool's inspector runs at 24 fps only during a shot. Reduced-motion preferences set the initial choice; the user can explicitly enable animation. Hidden or closed views stop rendering, and decoded assets/caches are released on teardown. There are no always-running game servers or model calls. The character cache holds at most 192 frames (about 8 MiB of raw pixels); tinted-fabric caches are bounded and each object image is decoded once per view and reused. This provides animated characters without independent GIF decoders or loading the full Rigby runtime.

## Art provenance

`public/office/pixel/furniture.webp` was generated with the built-in image-generation tool, then encoded losslessly as WebP (1.45 MB). Original generated PNGs remain in Codex's generated-images directory. Character frames and fabric palettes are drawn/cached by the app at runtime.

The current object files in `public/office/pixel/objects/` are extracted from a cleaned version produced by the same built-in tool. The original atlas remains for older clients but the new renderer does not request it. Each extraction uses the actual object's bounds to avoid neighboring-sprite fragments. Cleanup prompt:

> Use case: background-extraction. Edit target: this 1536 x 1024 office sprite atlas. Keep every object, material detail, style, size and location exactly. Remove all colored rectangular background stains, halos and shadows outside the furniture. Return actual transparent alpha everywhere except the furniture. Preserve the exact 6-column, 4-row ordering and all 24 objects, with transparent gutters. No text, floor, backdrops or cast shadows. Keep crisp detailed pixel edges and warm wood/green upholstery. Only background removal and spacing cleanup.

Generation prompt:

> Create a production pixel-art sprite atlas for a polished living office video game. ONE transparent PNG, exactly 1536 by 1024, 6 columns and 4 rows of 256x256 cells, independent objects with transparent gutters. Consistent 3/4 top-down orthographic RPG view, crisp pixels, warm walnut/oak, cream/brass accents, rich material details. No people, labels or floor. Row 1: four directional computer desks, north/south chairs. Row 2: west/east chairs, empty six-pocket pool table, TV/console cabinet, sofa, espresso bar. Row 3: water cooler, bookshelf, monstera, flowering plant, printer cabinet, conference table. Row 4: arcade, creative workstation, architectural model, gaming shelf/trophy, corkboard, coat rack.

Refinement prompt:

> Make this production spritesheet usable in a game: remove the entire colored background including every colored glow and ground shadow. Truly transparent alpha between and around every sprite. Preserve all 24 objects, exact positions, 6 columns × 4 rows, 1536×1024, 256×256 per cell. Render crisp retro pixel art with visible squared 2-pixel clusters, limited palette and hard pixel edges. Preserve intricate object details. No caption.

Verify with the office simulation, timeline, recreation, state and service tests. The local preview uses mock companies and game commands; production data is not needed for visual testing.
