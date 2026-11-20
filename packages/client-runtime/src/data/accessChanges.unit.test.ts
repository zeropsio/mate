import { expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";

import { liveProjects, ORG, projectValue, zeropsVersion } from "./__fixtures__/account.ts";
import { membershipInputs } from "./__fixtures__/membership.ts";
import { followAccessChanges } from "./accountRuntime/accessChanges.ts";
import { projectsScope } from "./families/project.ts";
import type { AccountInput } from "./reducer.ts";
import { accountReadsAtom } from "./reads.ts";
import { makeAccountStore } from "./store.ts";

/** The account shown, its person's access heard: each move's projects, in order. */
const heard = (inputs: ReadonlyArray<AccountInput>) => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  inputs.forEach(store.dispatch);
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
  const moves: Array<ReadonlyArray<string>> = [];
  const stop = followAccessChanges(registry, (projects) => void moves.push(projects));
  return { store, moves, stop };
};

/** `/user/info` read again: the person's membership in the organization as it now answers. */
const membershipRead = (roleCode: string) => membershipInputs(roleCode, false, 1, ORG).slice(3, 5);

// witness: packages/client-runtime/src/data/accountRuntime/accessChanges.ts | if (role === "unknown") roles[projectId] = "unread"; → if (role === "unknown") roles[projectId] ??= "unread";
it("ST79: One change of the person's access is told once: a project whose role is still being read when the move is told counts its first role as no move", () => {
  const { store, moves, stop } = heard([
    ...membershipInputs("NO_ACCESS", false, 1, ORG),
    ...liveProjects(ORG, []),
  ]);
  // Promoted: Zerops lists the projects by id, then `/user/info` answers, then their rows.
  store.dispatch({
    kind: "membership",
    scope: projectsScope(ORG),
    generation: 1,
    delta: { add: ["p1", "p2"], remove: [] },
  });
  membershipRead("BASIC_USER").forEach(store.dispatch);
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: ["p1", "p2"].map((id) => ({
      family: "project" as const,
      id,
      value: projectValue({ id }),
      revision: zeropsVersion(1),
    })),
  });
  expect(moves).toEqual([[]]);
  stop();
});

// witness: packages/client-runtime/src/data/accountRuntime/accessChanges.ts | for (const projectId of [...roster.ids, ...roster.unverified]) { → for (const projectId of roster.ids) {
it("ST80: A listed project whose absence is being verified keeps the role its held row gives under the current membership, so its verified leaving after a demotion tells no second move", () => {
  const { store, moves, stop } = heard([
    ...membershipInputs("BASIC_USER", false, 1, ORG),
    ...liveProjects(ORG, [{ id: "p1" }, { id: "p2" }, { id: "p3" }]),
  ]);
  // Demoted to No access: the roster read again lists none, then `/user/info` answers, then each
  // project's owner refuses it.
  store.dispatch({ kind: "baseline-begin", scope: projectsScope(ORG), generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope: projectsScope(ORG),
    generation: 1,
    via: "zerops-read",
    members: [],
    rows: [],
  });
  membershipRead("NO_ACCESS").forEach(store.dispatch);
  for (const id of ["p1", "p2", "p3"])
    store.dispatch({ kind: "access", family: "project", id, access: "denied" });
  expect(moves).toEqual([["p1", "p2", "p3"]]);
  stop();
});
