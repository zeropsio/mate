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
  for (const [failure, party, line] of rows) {
    const [step] = releaseSheetSteps({
      tag: "v0.1.0",
      outcome: { kind: "failed" },
      pressing: false,
      plan: {
        hash: "a".repeat(64),
        vault: { state: "known", gaps: [] },
        operations: [{ kind: "create", service: "app", settings: {}, cost: "" }],
      },
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
    expect(step?.action).toBeUndefined();
  }
});

// witness: apps/web/src/components/zerops/review/releaseSheet.logic.ts | const recorded = offered ? [] : (progress?.creation?.services ?? []); → const recorded = progress?.creation?.services ?? [];
it("RV14: Before approval production shows only the reviewed service plan, and after approval the creation step follows HQ's release receipt", () => {
  const tag = "v0.1.1";
  const prior = {
    tag: "v0.1.0",
    state: "created" as const,
    services: ["old"],
    at: "2026-11-25T21:13:49Z",
    endedAt: "2026-11-25T21:13:49Z",
    reason: undefined,
  };
  const input: Parameters<typeof releaseSheetSteps>[0] = {
    tag,
    outcome: { kind: "offered" },
    pressing: false,
    plan: undefined,
    services: [],
    untouched: [],
    versions: new Map(),
    replaces: { kind: "first" },
    host: undefined,
    progress: { creation: prior, deploys: [] },
    stopped: undefined,
    nowMs: Date.parse(prior.at),
  };
  const creation = (changes: Partial<typeof input>) =>
    releaseSheetSteps({ ...input, ...changes })
      .filter((step) => step.kind === "create")
      .map(({ service, mark, action }) => [service, mark, action]);
  expect(creation({})).toEqual([]);
  expect(
    creation({
      plan: {
        hash: "a".repeat(64),
        vault: { state: "known", gaps: [] },
        operations: [{ kind: "create", service: "app", settings: {}, cost: "" }],
      },
    }),
  ).toEqual([["app", "pending", undefined]]);
  expect(
    creation({
      outcome: { kind: "releasing" },
      progress: {
        creation: { ...prior, tag, services: ["app"], state: "creating", endedAt: null },
        deploys: [],
      },
    }),
  ).toEqual([["app", "busy", undefined]]);
  expect(
    creation({
      outcome: { kind: "releasing" },
      progress: { creation: { ...prior, tag, services: ["app"] }, deploys: [] },
    }),
  ).toEqual([["app", "done", undefined]]);
});
