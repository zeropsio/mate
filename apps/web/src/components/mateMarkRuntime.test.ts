import { describe, expect, it } from "vite-plus/test";

import { markBandTarget } from "./mateMarkRuntime";

// Where the band sits for a pose: in asleep, out awake — and waking, in, with a slow low swell, so
// a Mate on its way up never stands as still as one at rest (`matePose`).
describe("markBandTarget", () => {
  it.each([
    { state: "idle", reduced: false, at: [0, 0.75, 1.5], band: [1, 1, 1] },
    { state: "working", reduced: false, at: [0, 0.75, 1.5], band: [1, 1, 1] },
    { state: "sleep", reduced: false, at: [0, 0.75, 1.5], band: [0, 0, 0] },
    { state: "sleep", reduced: true, at: [0, 0.75, 1.5], band: [0, 0, 0] },
    { state: "waking", reduced: true, at: [0, 0.75, 1.5], band: [0, 0, 0] },
  ] as const)("$state, reduced $reduced: still", ({ state, reduced, at, band }) => {
    expect(at.map((seconds) => markBandTarget(state, seconds, reduced))).toEqual(band);
  });

  it("waking, it swells and settles once every three seconds, never past a quarter out", () => {
    const samples = Array.from({ length: 31 }, (_, index) =>
      markBandTarget("waking", index / 10, false),
    );
    expect(samples[0]).toBeCloseTo(0);
    expect(Math.max(...samples)).toBeGreaterThan(0.1);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.25);
    expect(samples[15]).toBeCloseTo(Math.max(...samples));
    expect(samples[30]).toBeCloseTo(0);
  });
});
