import { describe, expect, it } from "@effect/vitest";

import { pressElsewhere, type HqPresses } from "./pressElsewhere.ts";

// B5: two browsers, one press. Whether the other one's press still runs is HQ's word on its hold
// and its import's, never the project's age, and never this browser's clock.
describe("pressElsewhere", () => {
  const held = (importProcessId?: string): HqPresses => ({
    p1: { kind: "mate", ...(importProcessId === undefined ? {} : { importProcessId }) },
  });

  it.each<{
    readonly case: string;
    readonly presses: HqPresses | null;
    readonly importStatus?: string;
    readonly said: ReturnType<typeof pressElsewhere>;
  }>([
    { case: "HQ said nothing of presses yet: unknown", presses: null, said: "unknown" },
    { case: "HQ holds no press of it: stopped", presses: {}, said: "stopped" },
    { case: "HQ holds its press: pressing", presses: held(), said: "pressing" },
    {
      case: "its import queued: pressing, its container on its way",
      presses: held("imp-1"),
      importStatus: "PENDING",
      said: "pressing",
    },
    {
      case: "its import failed, its hold still held: stopped at once",
      presses: held("imp-1"),
      importStatus: "FAILED",
      said: "stopped",
    },
    { case: "its import not read yet: its hold says", presses: held("imp-1"), said: "pressing" },
  ])("$case", ({ presses, importStatus, said }) => {
    expect(pressElsewhere({ presses, projectId: "p1", importStatus })).toBe(said);
  });
});
