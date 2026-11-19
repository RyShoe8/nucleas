# Office artwork sources

Original artwork generated with the built-in image generation tool. The six roles, in order, are Design, Creative, Engineering, Support, Operations and Marketing. Tester remains inactive.

## Final prompt set

Walk atlas: transparent 1024 x 1536 image, strict four-column, six-row grid of square cells. Premium stylized 3D adult characters, complete standalone bodies, no furniture, text or background. Each row preserves one identity across four walking poses (left contact, passing, right contact, opposite passing), facing right, consistent camera, scale and foot baseline. Soft lighting with a subtle violet rim. Design: auburn bob, lavender sweater, charcoal trousers, white shoes. Creative: curly golden hair, teal beanie, orange overshirt, olive trousers. Engineering: brown skin, dark wavy hair, glasses, mint hoodie. Support: dark skin, bun, headset, rose blouse, cream trousers. Operations: silver hair, navy suit, cream shirt. Marketing: East Asian man, swept dark hair, cobalt overshirt, charcoal trousers.

Idle atlas: use the walk atlas as the identity reference. Transparent 1536 x 1024 image, strict three-column, two-row grid. Preserve all six identities, clothing and render style. Relaxed standing poses with both feet planted. Full bodies only; no desks, chairs, scenery or text.

Furniture atlas: transparent 1536 x 1024 image, strict three-column, two-row grid. Six independent walnut workstations, charcoal legs, role-colored chairs, monitors, plants and task lights. No people. IMPORTANT: monitors sit on the far edge; chairs are on the near keyboard side with their backs visible, facing away from the camera toward the monitor. Chairs are slightly pulled out toward the lower right. Preserve the polished miniature 3D style.

The final PNG atlases are retained here. Rebuild delivery assets using `node scripts/build-office-characters.mjs` from the repository root. Sharp only slices, resizes and packages the generated artwork; it does not draw replacement characters.

## Shared office amenities

Generated with the built-in image generation tool, using `design-desk.webp` as a style reference. Final source: `amenities-atlas.png`. Delivery files: `public/office/amenities/*.webp` (nine 384px transparent assets, about 302 KB total). Rebuild using `node scripts/build-office-amenities.mjs`.

Final prompt: create a strict three-column, three-row transparent atlas of premium miniature 3D furnishings, matching the walnut desk reference, elevated orthographic camera and soft lighting. Each square cell contains one isolated grouping with transparent margins. Row one: conference table with six inward-facing blue chairs and notebooks; freestanding projector screen and projector on a stand; sage couch viewed from behind with coffee table. Row two: walnut coffee bar with espresso machine, cups and plant; white water cooler with blue bottle and red/blue taps; leafy plant in ceramic pot. Row three: walnut pool table with teal felt, balls and cue rack; TV showing a blue-green game landscape on a cabinet with console and two controllers; curved walnut and teal reception desk. No people, walls, labels, text or baked-in backgrounds. Preserve consistent camera and lighting across cells.

The building uses existing company relationship labels: owned/internal in the company wing, clients in smaller suites. Shared amenities are selectable. Office visits are local visual state, not scheduled work, billing, simulated AI activity or changes to assignment records. Available members can join within the amenity capacity; members whose work becomes running or needs review return to their desks. Visits reset when the office view is remounted. Static furniture is lazy-loaded; character motion is gated by visibility and reduced-motion preferences.
