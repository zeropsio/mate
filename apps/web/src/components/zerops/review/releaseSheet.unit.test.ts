import { expect, it } from "vite-plus/test";

import { releaseSheetSteps } from "./releaseSheet.logic.ts";

// witness: apps/web/src/components/zerops/review/releaseSheet.logic.ts | creation.refused === true → creation.refused !== true
it("RV8: A creation HQ refused is said as HQ's refusal in HQ's words, and one Zerops failed as Zerops'; breaks: the release sheet blames Zerops for HQ's decision and the person looks for the fault in the wrong place.", () => {
  const reason = "web's zerops.yaml at 914369c has no setup app-preview";
  const rows = [
    [{ refused: true, reason }, "HQ", reason],
    [{ refused: true, reason: undefined }, "HQ", "HQ gave no reason"],
    [{ reason }, "Zerops", reason],
    [{ reason: undefined }, "Zerops", "Zerops gave no reason"],
  ] as const;
  const steps = rows.map(([failure, party, line]) => {
    const [step] = releaseSheetSteps({
      tag: "v0.1.0",
      outcome: { kind: "failed" },
      pressing: false,
      plan: {
        hash: "a".repeat(64),
        vault: { state: "known", gaps: [] },
        operations: [{ kind: "create", service: "app", settings: {}, cost: "" }],
      },
      created: [],
      early: { kind: "none" },
      canCreate: true,
      services: [],
      untouched: [],
      versions: new Map(),
      replaces: { kind: "first" },
      host: undefined,
      progress: {
        creation: {
          tag: "v0.1.0",
          state: "failed",
          ...failure,
          services: ["app"],
          at: "2026-11-25T21:13:49Z",
          endedAt: null,
        },
        deploys: [],
      },
      stopped: undefined,
      nowMs: 0,
    });
    expect(step?.title[0]?.toString().split(" ")[0]).toBe(party);
    expect(step?.title[1]).toEqual({ code: "app" });
    expect(step?.line).toEqual([line]);
    return step;
  });
  expect(steps[0]?.action).toBe("create-again");
  expect(steps[0]?.action).toBe(steps[2]?.action);
});
