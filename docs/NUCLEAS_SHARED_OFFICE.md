# Organization office

`OfficeScene` stores one scene per organization (`_id` is the organization ID). It includes canonical company geometry, employee routes and positions at a server timestamp, and requested amenity visits. No user ID or local storage key selects a different scene.

`/api/os/office` authenticates the viewer, reads the organization's persisted scene, and filters company details through existing company access checks. Layout and seat allocation happen before filtering, so people who have different company access still see shared employees in the same positions. The service's internal administrator scope is used only to read the organization's complete office inputs; it never grants the caller those permissions or performs work as that administrator.

The first reader advances the scene at most once every five seconds. Work context refreshes every twenty seconds; displayed metrics refresh every five minutes. Manual visits refresh work context before accepting a move. Revision-based compare-and-swap writes prevent concurrent windows or application instances from losing each other's changes. A full shared amenity or a busy employee produces a visible conflict instead of a private visit.

Clients poll every five seconds while visible and interpolate persisted routes against server time. They do not choose destinations or accumulate a local simulation clock. A late join, reload or resumed tab catches up to the shared scene. There is no always-running simulation process or per-frame database traffic. While nobody is viewing, routes are advanced lazily on the next request; the system does not record an invented history of unattended breaks.

Zoom, scrolling, selections and reduced-motion preferences stay personal. Reduced motion samples the latest shared positions without continuous movement; it does not pause colleagues' office. If disconnected, interpolation stops after ten seconds, an error is shown, and the next successful fetch restores the shared state.

The company list reads the same snapshot and no longer maintains a second local activity simulation. Work permissions, budgets, jobs and automation schedules are unchanged.
