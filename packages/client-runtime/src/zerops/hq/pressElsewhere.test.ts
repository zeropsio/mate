import { describe, expect, it } from "@effect/vitest";

import { pressElsewhere, type HqPresses } from "./pressElsewhere.ts";

// B5: two browsers, one press. Whether the other one's press still runs is its hold's and its
// import's word at HQ, never the project's age.
describe("pressElsewhere", () => {
  const held = (runsOn: boolean, importProcessId?: string): HqPresses => ({
    p1: {
      kind: "mate",
      held: runsOn,
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
    { case: "no press holds it: awaiting evidence", presses: {}, said: "unknown" },
    {
      case: "its press is gone but its recorded import runs: pressing",
      presses: {},
      importStatus: "RUNNING",
      said: "pressing",
    },
    {
      case: "its press is gone but its recorded import failed: stopped",
      presses: {},
      importStatus: "FAILED",
      said: "stopped",
    },
    {
      case: "its press is gone but its recorded import was canceled: stopped",
      presses: {},
      importStatus: "CANCELED",
      said: "stopped",
    },
    // Run 2 (2026-10-16): a press that went through leaves no record at HQ, and its Mate read as
    // half made until its container was listed. One that stops keeps its record.
    {
      case: "its press went through, HQ let its hold go: never said stopped",
      presses: {},
      said: "unknown",
    },
    { case: "a slow press, its hold renewed: pressing", presses: held(true), said: "pressing" },
    { case: "its hold ran out: awaiting evidence", presses: held(false), said: "unknown" },
    {
      case: "its import queued, its hold ran out: pressing, its container on its way",
      presses: held(false, "imp-1"),
      importStatus: "PENDING",
      said: "pressing",
    },
    {
      case: "its import failed, its hold still running: stopped at once",
      presses: held(true, "imp-1"),
      importStatus: "FAILED",
      said: "stopped",
    },
    {
      case: "its import not read yet: its hold says",
      presses: held(true, "imp-1"),
      said: "pressing",
    },
  ])("$case", ({ presses, importStatus, said }) => {
    expect(pressElsewhere({ presses, projectId: "p1", importStatus })).toBe(said);
  });
});
