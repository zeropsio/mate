import { expect, it } from "vite-plus/test";

import type { FlowReleaseRow } from "./release.ts";
import { releaseFollows, releaseOutcomeOf } from "./releaseFacts.ts";

const TAGGED = "2026-11-01T08:00:00Z";

const row = (
  tag: string,
  standing: FlowReleaseRow["standing"],
  verdict: FlowReleaseRow["verdict"] = "approved",
): FlowReleaseRow => ({
  tag,
  verdict,
  detail: undefined,
  line: "",
  entries: [{ service: "api", commit: "a".repeat(40) }],
  taggedAt: TAGGED,
  standing,
  word: "",
  rollBack: false,
  failedEntries: [],
});

// witness: packages/client-runtime/src/zerops/releaseFacts.ts | ? input.releases.slice(0, at).find((entry) => entry.verdict !== "refused") → ? input.releases.slice(0, at)[0]
it("ZV148: A release HQ stopped following without landing reads unknown with its clock stopped, and a followed release ends when a newer, unrefused one sits above it", () => {
  const stall = { tag: "v0.1.1", at: undefined, reasons: [] };
  const stalledRows = [row("v0.1.1", undefined), row("v0.1.0", "live")];
  const stalled = releaseFollows({
    made: "v0.1.1",
    held: undefined,
    press: { kind: "done" },
    inFlight: undefined,
    stalled: stall,
    suggestion: "v0.1.2",
    releases: stalledRows,
  });
  expect(stalled.ticking).toBe(false);
  expect(
    releaseOutcomeOf({
      tagged: stalled.tagged,
      releasing: stalled.releasing,
      stalled: stalled.stalled,
      superseded: stalled.superseded,
      reads: { environmentInputs: [], stalled: stall },
      pressing: false,
      tag: stalled.tag,
      clockMs: 0,
    }),
  ).toEqual({ kind: "stalled", at: TAGGED });

  const follow = (newer: FlowReleaseRow, inFlight: string | undefined) =>
    releaseFollows({
      made: "v0.1.1",
      held: undefined,
      press: { kind: "done" },
      inFlight,
      stalled: undefined,
      suggestion: "v0.1.3",
      releases: [newer, row("v0.1.1", undefined), row("v0.1.0", "live")],
    });
  const superseded = follow(row("v0.1.2", undefined), "v0.1.2");
  expect(superseded.superseded).toEqual({ by: "v0.1.2", live: "v0.1.0" });
  expect(superseded.ticking).toBe(false);
  expect(
    releaseOutcomeOf({
      tagged: superseded.tagged,
      releasing: superseded.releasing,
      stalled: superseded.stalled,
      superseded: superseded.superseded,
      reads: { environmentInputs: [], stalled: undefined },
      pressing: false,
      tag: superseded.tag,
      clockMs: 0,
    }),
  ).toEqual({ kind: "superseded", by: "v0.1.2", live: "v0.1.0" });

  const refused = follow(row("v0.1.2", undefined, "refused"), undefined);
  expect(refused.superseded).toBeUndefined();
  expect(refused.ticking).toBe(true);
});
