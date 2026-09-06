import { describe, expect, it } from "vite-plus/test";

import { monotonePath, sparklineGeometry } from "./sparkline";

describe("monotonePath", () => {
  it("is empty for no points and a move for one", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 3, y: 4 }])).toBe("M3,4");
  });

  it("draws a straight segment between two points", () => {
    expect(
      monotonePath([
        { x: 0, y: 10 },
        { x: 30, y: 4 },
      ]),
    ).toBe("M0,10 C10,8 20,6 30,4");
  });

  it("keeps a flat stretch flat and never overshoots a step", () => {
    const path = monotonePath([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 2 },
      { x: 30, y: 2 },
    ]);

    // The flat first segment stays on y=10 and the flat last one on y=2: no
    // control point leaves the band between the samples.
    expect(path).toBe("M0,10 C3.33,10 6.67,10 10,10 C13.33,10 16.67,2 20,2 C23.33,2 26.67,2 30,2");
  });
});

describe("sparklineGeometry", () => {
  const point = (used: number, limit: number) => ({ at: "t", used, limit });

  it("is empty for an empty trend", () => {
    expect(sparklineGeometry([], 100, 20)).toEqual({ line: "", area: "", end: undefined });
  });

  it("scales to the most that was used, not to the allocation", () => {
    const geometry = sparklineGeometry([point(0.5, 2), point(1, 2), point(1, 2)], 100, 22, 1);

    // 20 px usable: 1 GB used is the top (y=1), 0.5 GB is halfway (y=11).
    expect(geometry.line.startsWith("M1,11 ")).toBe(true);
    expect(geometry.end).toEqual({ x: 99, y: 1 });
    expect(geometry.area.endsWith(" L99,21 L1,21 Z")).toBe(true);
  });

  it("draws along the baseline when nothing was used", () => {
    const geometry = sparklineGeometry([point(0, 2), point(0, 2)], 100, 22);

    expect(geometry.line).toBe("M1,21 C33.67,21 66.33,21 99,21");
    expect(geometry.end).toEqual({ x: 99, y: 21 });
  });
});
