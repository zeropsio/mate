import { expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/unstable/reactivity";
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { lifecycleRemainders } from "./lifecycleRemainders.ts";
import { recordedMoveRemainder } from "./recordedMoveRemainder.ts";

const MOVE: HqLifecycleRecord = {
  requestId: "move",
  intent: {
    kind: "move-project",
    orgId: ORG,
    hqProjectId: "hq",
    projectId: "p1",
    from: { appId: "before", kind: "mate" },
    to: { appId: "after", kind: "mate" },
    rename: { from: "Before · Ada", name: "After · Ada" },
  },
};
const PREPARED: HqLifecycleRecord = {
  requestId: "prepare",
  intent: { kind: "prepare-mate-deletion", orgId: ORG, hqProjectId: "hq", projectId: "p1" },
  result: { keyTokenId: "exact-key", completion: "seal" },
};
const key = { orgId: ORG, hqProjectId: "hq" };

it.each([
  "current",
  "not-delivered",
  "outage",
  "refusal",
  "renamed",
  "moved-again",
  "other-HQ",
] as const)("restores only a safe original Move remainder: %s", (caseName) => {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({
    running: [],
    projects: [{ id: "p1", name: caseName === "renamed" ? "After · Ada" : "Before · Ada" }],
  }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    lifecycle: caseName === "not-delivered" ? [] : [MOVE],
    live: caseName !== "outage",
    structure: {
      apps: [
        {
          id: caseName === "moved-again" ? "other" : "after",
          name: "After",
          projects: [{ projectId: "p1", name: "Ada", kind: "mate", mate: { face: "" } }],
        },
      ],
      ungrouped: [],
    },
  });
  if (caseName === "refusal")
    store.dispatch({ kind: "access", family: "hqLifecycle", id: "move", access: "denied" });
  const read = readsOfState(store.state());
  const selected = { ...key, hqProjectId: caseName === "other-HQ" ? "replacement" : "hq" };
  expect(recordedMoveRemainder.derive(read, { ...selected, requestId: "move" }).kind).toBe(
    caseName === "current"
      ? "rename"
      : caseName === "not-delivered"
        ? "checking"
        : caseName === "outage"
          ? "unobserved"
          : caseName === "refusal" || caseName === "other-HQ"
            ? "withheld"
            : caseName === "renamed"
              ? "done"
              : "superseded",
  );
  expect(lifecycleRemainders.derive(read, selected).renames.size).toBe(
    caseName === "current" ? 1 : 0,
  );
});

it.each(["prepared", "completed", "retired", "other-HQ"] as const)(
  "a reopened deletion exposes only unfinished cleanup: %s",
  (caseName) => {
    const store = makeAccountStore(AtomRegistry.make());
    liveZerops({ running: [], projects: [] }).forEach(store.dispatch);
    const target = { orgId: ORG, hqProjectId: "hq", projectId: "p1" };
    const records: HqLifecycleRecord[] = [PREPARED];
    if (caseName !== "prepared")
      records.push({
        requestId: "prepare:complete",
        intent: {
          kind: "complete-mate-deletion",
          ...target,
          preparedRequestId: "prepare",
          completion: "seal",
        },
      });
    if (caseName === "retired")
      records.push({
        requestId: "prepare:retired",
        intent: {
          kind: "complete-key-retirement",
          ...target,
          preparedRequestId: "prepare",
          completionRequestId: "prepare:complete",
        },
      });
    seedHqNavigation(store, ORG, { lifecycle: records });
    expect(
      lifecycleRemainders.derive(readsOfState(store.state()), {
        ...key,
        hqProjectId: caseName === "other-HQ" ? "replacement" : "hq",
      }).deletions,
    ).toEqual(caseName === "completed" ? [PREPARED] : []);
  },
);
