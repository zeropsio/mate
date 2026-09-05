# Mate identity

The first identity integration covers the web sidebar, new-thread hero, sign-in
shell, and favicon. Geometry comes from identity v1 at
https://logo-212e-3000.prg1.zerops.app/ and lives in `MATE_MARK` (the still
mark) and `MATE_MARK_LIVE` (the grid the animation is measured from) in
`packages/shared/src/brand.ts`. `MATE_MARK_LIVE` derives its numbers from the
logo's own stroke and window rather than restating them, and `brand.test.ts`
pins that derivation against `MATE_MARK`'s constants — so the still and live
forms cannot drift apart. The favicon is generated from the same source by
`scripts/generate-theme-tokens.ts`; keep editing the generator, not its output.

`MateMark` is decorative presence, with no provider or connection status.

It renders in two forms. The **still** mark is the open face and nothing else:
no band, no extrusion, no mouth, no timer. That is what the sidebar and the
favicon use. The **live** mark (`playful`) is identity v1's animated mark,
ported from the identity site's `mate.js`: it starts closed as the plain Zerops
logo, its band retracts along its own 30° as it wakes, the eyes open behind it,
the slab turns up to 5° toward the pointer with a 12-layer extruded side wall
fading in as it moves, and it blinks. It wanders when the pointer is elsewhere
and sleeps — band back in, eyes shut — after 45 s of no input anywhere.

This supersedes the first integration's rule that no idle loop or timer runs.
It was a deliberate constraint then and is deliberately lifted now: the live
mark is the identity, and the still form exists for every place that should not
pay for it. The cost is bounded rather than absent — `mateMarkRuntime.ts` runs
one `requestAnimationFrame` and one pointer listener for every live mark on the
page, starts them with the first and stops them with the last, drops off-screen
marks to 4 Hz, and writes attributes directly so a 60 Hz animation never
re-renders a component. A page with only still marks schedules no frame at all.

Reduced motion holds the live mark open, still and forward: no band, no gaze,
no tilt, no blink.

The Electron source uses the same web component. Native mobile presentation is
deferred: it retains its current brand marks, can reuse the shared geometry, and
must not acquire pointer behavior. Narrow hosted-web layouts use the same mark
and reduced sizes. No contracts, providers, or shared thread status rules change.
Platform operation cards and the boot splash retain the Zerops mark.
