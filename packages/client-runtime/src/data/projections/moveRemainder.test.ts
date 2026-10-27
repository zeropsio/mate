import { expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, projectValue } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { projectsScope } from "../families/project.ts";
import type { MoveProjectIntent } from "../operations/moveProject.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { moveRemainder } from "./moveRemainder.ts";

const MOVE: MoveProjectIntent = {
  kind: "move-project",
  orgId: ORG,
  hqProjectId: "hq",
  projectId: "p1",
  from: { appId: "before", kind: "mate" },
  to: { appId: "after", kind: "mate" },
  rename: { from: "Before · Ada", name: "After · Ada" },
};
const key = { orgId: ORG, hqProjectId: "hq", requestId: "original" };

it.each([
  { caseName: "rename remains", name: MOVE.rename.from, destination: "after", expected: "rename" },
  { caseName: "already renamed", name: MOVE.rename.name, destination: "after", expected: "done" },
  { caseName: "manual rename", name: "New name", destination: "after", expected: "superseded" },
  {
    caseName: "moved again",
    name: MOVE.rename.from,
    destination: "another",
    expected: "superseded",
  },
  { caseName: "another account", name: MOVE.rename.from, destination: "after", expected: "none" },
  { caseName: "replacement HQ", name: MOVE.rename.from, destination: "after", expected: "none" },
  { caseName: "denied", name: MOVE.rename.from, destination: "after", expected: "withheld" },
  { caseName: "outage", name: MOVE.rename.from, destination: "after", expected: "checking" },
  { caseName: "lost answer", name: MOVE.rename.from, destination: "before", expected: "waiting" },
])("a restored original Move shows only its safe remainder: $caseName", (entry) => {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects: [{ id: "p1", name: entry.name }] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: entry.destination,
          name: entry.destination,
          projects: [{ projectId: "p1", name: "Ada", kind: "mate", mate: { face: "" } }],
        },
      ],
      ungrouped: [],
    },
    live: entry.caseName !== "outage",
  });
  store.dispatch({ kind: "operation-recorded", requestId: "original", intent: MOVE, before: [] });
  if (entry.caseName === "lost answer")
    store.dispatch({ kind: "operation-lookup-failed", requestId: "original" });
  else
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId: "original",
        operationId: "p1",
        executor: "hq",
        affected: [],
        handles: ["p1"],
        acceptance: { kind: "accepted" },
        outcome: { kind: "succeeded", evidence: "HQ answered the original Move" },
      },
    });
  if (entry.caseName === "denied")
    store.dispatch({ kind: "access", family: "project", id: "p1", access: "denied" });
  const value = moveRemainder.derive(readsOfState(store.state()), {
    ...key,
    orgId: entry.caseName === "another account" ? "other" : ORG,
    hqProjectId: entry.caseName === "replacement HQ" ? "replacement" : "hq",
  });
  expect(value.kind).toBe(entry.expected);
  if (entry.expected === "rename") {
    expect(value).toEqual({ kind: "rename", projectId: "p1", ...MOVE.rename });
    // The platform rename arrives separately; it never needs another placement write.
    store.dispatch({
      kind: "rows",
      scope: projectsScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "project",
          id: "p1",
          value: projectValue({ id: "p1", name: MOVE.rename.name }),
          revision: { kind: "zerops", version: 2 },
        },
      ],
    });
    expect(moveRemainder.derive(readsOfState(store.state()), key)).toEqual({ kind: "done" });
  }
});
