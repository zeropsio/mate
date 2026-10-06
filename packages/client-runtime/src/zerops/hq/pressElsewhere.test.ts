import { describe, expect, it } from "@effect/vitest";

import { nextPressExpiry, pressElsewhere, type HqPresses } from "./pressElsewhere.ts";

const NOW = Date.parse("2026-10-05T10:00:00.000Z");

// B5: two browsers, one press. Whether the other one's press still runs is its hold's and its
// import's word at HQ, never the project's age.
describe("pressElsewhere", () => {
  const held = (expiresInMs: number, importProcessId?: string): HqPresses => ({
    p1: {
      kind: "mate",
      expiresAtMs: NOW + expiresInMs,
      ...(importProcessId === undefined ? {} : { importProcessId }),
    },
  });

  it.each<{
    readonly case: string;
    readonly presses: HqPresses | null;
    readonly importStatus?: string;
    readonly said: ReturnType<typeof pressElsewhere>;
  }>([
    { case: "HQ said nothing of presses yet: unknown", presses: null, said: "unknown" },
    { case: "no press holds it: stopped", presses: {}, said: "stopped" },
    { case: "a slow press, its hold renewed: pressing", presses: held(30_000), said: "pressing" },
    { case: "its tab closed, its hold ran out: stopped", presses: held(0), said: "stopped" },
    {
      case: "its import queued, its hold ran out: pressing, its container on its way",
      presses: held(-60_000, "imp-1"),
      importStatus: "PENDING",
      said: "pressing",
    },
    {
      case: "its import failed, its hold still running: stopped at once",
      presses: held(30_000, "imp-1"),
      importStatus: "FAILED",
      said: "stopped",
    },
    {
      case: "its import not read yet: its hold says",
      presses: held(30_000, "imp-1"),
      said: "pressing",
    },
  ])("$case", ({ presses, importStatus, said }) => {
    expect(pressElsewhere({ presses, projectId: "p1", nowMs: NOW, importStatus })).toBe(said);
  });

  it("says when the soonest hold still running runs out", () => {
    const presses: HqPresses = {
      p1: { kind: "mate", expiresAtMs: NOW + 50_000 },
      p2: { kind: "stage", expiresAtMs: NOW + 20_000 },
      p3: { kind: "mate", expiresAtMs: NOW - 1 },
    };
    expect(nextPressExpiry(presses, NOW)).toBe(NOW + 20_000);
    expect(nextPressExpiry({ p3: { kind: "mate", expiresAtMs: NOW } }, NOW)).toBeNull();
    expect(nextPressExpiry(null, NOW)).toBeNull();
  });
});
