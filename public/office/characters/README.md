# Office characters and furniture

Six original characters replace the pixel placeholders. Each role has a transparent 192px idle WebP, a transparent 192px four-frame walking GIF and a separate 256px workstation WebP. Furniture is never baked into a person. Chairs are on the keyboard side, facing the monitor.

Source atlases and generation prompts live in `design/office-characters/`. Rebuild with `node scripts/build-office-characters.mjs`.

The room component arranges separate company studios and keeps role positions stable as job states change. Available members stroll; working, waiting and unassigned members use stills. Walking is ambient and does not imply a running job. Selecting a person opens their existing work destination.

Animation switches to stills outside the viewport, while the document is hidden, or when reduced motion is requested. Each room uses one observer and no animation timers. All six characters, GIFs and desks together are approximately 470 KB; source atlases are not served to the app. Asset tests enforce transparency, frame timing and a 600 KB total ceiling.
