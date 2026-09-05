# Mate identity

The first identity integration covers the web sidebar, new-thread hero, sign-in
shell, and favicon. Geometry comes from identity v1 at
https://logo-212e-3000.prg1.zerops.app/ and lives in `MATE_MARK` in
`packages/shared/src/brand.ts`. The favicon is generated from the same source by
`scripts/generate-theme-tokens.ts`; keep editing the generator, not its output.

`MateMark` is decorative presence, with no provider or connection status. Only
the larger entry marks wake and follow the mouse across the window, with bounded
eye travel relative to the mark's center. A window pointer listener coalesces
movement into one animation frame and is removed when the mark unmounts. Losing
focus or leaving the window resets the gaze. Their CSS animations end; no idle
animation loop or timer runs.
Reduced motion renders the final open mark and disables gaze transitions.

The Electron source uses the same web component. Native mobile presentation is
deferred: it retains its current brand marks, can reuse the shared geometry, and
must not acquire pointer behavior. Narrow hosted-web layouts use the same mark
and reduced sizes. No contracts, providers, or shared thread status rules change.
Platform operation cards and the boot splash retain the Zerops mark.
