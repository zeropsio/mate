import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { planRingSegments, PlanRing } from "./PlanRing";

describe("planRingSegments — one segment a plan step", () => {
  it.each([
    { completed: 0, total: 3, states: ["running", "waiting", "waiting"] },
    { completed: 1, total: 3, states: ["done", "running", "waiting"] },
    { completed: 2, total: 3, states: ["done", "done", "running"] },
    { completed: 3, total: 3, states: ["done", "done", "done"] },
    { completed: 7, total: 3, states: ["done", "done", "done"] },
    { completed: 0, total: 1, states: ["running"] },
  ])("$completed of $total: $states", ({ completed, total, states }) => {
    expect(planRingSegments(completed, total).map((segment) => segment.state)).toEqual(states);
  });

  it("leaves a gap at the top of the ring, where the spine comes in", () => {
    const [first] = planRingSegments(0, 4);
    expect(first!.from).toBeGreaterThan(0);
    expect(planRingSegments(0, 4).at(-1)!.to).toBeLessThan(360);
  });

  it("draws one step as a whole ring, with no gap to leave", () => {
    const [only] = planRingSegments(0, 1);
    expect(only!.from).toBe(0);
    expect(only!.to).toBe(360);
  });

  it("draws nothing for a plan with no steps", () => {
    expect(planRingSegments(0, 0)).toEqual([]);
  });
});

describe("PlanRing", () => {
  it("draws a segment per step in the busy tone: done full, running half, waiting a track", () => {
    const html = renderToStaticMarkup(<PlanRing completed={1} total={3} />);
    expect(html.match(/data-plan-ring-segment=/gu)).toHaveLength(3);
    expect(html).toContain('data-plan-ring-segment="done"');
    expect(html).toContain('data-plan-ring-segment="running"');
    expect(html).toContain('data-plan-ring-segment="waiting"');
    expect(html).toContain("stroke-status-busy");
    // Decorative: the step it is on is written beside it.
    expect(html).toContain('aria-hidden="true"');
  });
});
