import { expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { projectsScope } from "../families/project.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { organizationProjects, projectGone } from "./projects.ts";

const SCOPE = projectsScope(ORG);
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const delta = (add: ReadonlyArray<string>, remove: ReadonlyArray<string>): AccountInput => ({
  kind: "membership",
  scope: SCOPE,
  generation: 1,
  delta: { add, remove },
});
const live = () =>
  apply(emptyAccount, liveZerops({ running: [], projects: [{ id: "a" }, { id: "b" }] }));
const roster = (state: AccountState) => {
  const projects = organizationProjects.derive(readsOfState(state), ORG);
  return { ids: projects.projects.map((project) => project.id), complete: projects.complete };
};
const gone = (state: AccountState) =>
  projectGone.derive(readsOfState(state), { orgId: ORG, projectId: "a" });

// witness: packages/client-runtime/src/data/projections/projects.ts | read.fact("project", projectId).kind === "deleted" → read.fact("project", projectId).kind !== "known"
it("PJ36: A project taken from the viewer is withheld, never claimed deleted, and one that left the roster is gone only once proven deleted", () => {
  // Left the roster, not yet proven gone: kept, partial.
  expect(roster(apply(live(), [delta([], ["a"])]))).toEqual({ ids: ["a", "b"], complete: false });
  // Proven deleted: gone.
  expect(
    roster(
      apply(live(), [
        delta([], ["a"]),
        { kind: "proven-deletion", family: "project", id: "a", evidence: "GET 404" },
      ]),
    ),
  ).toEqual({ ids: ["b"], complete: true });
  // Taken from the viewer: withheld, never claimed deleted.
  expect(
    roster(
      apply(live(), [
        delta([], ["a"]),
        { kind: "access", family: "project", id: "a", access: "denied" },
      ]),
    ),
  ).toEqual({ ids: ["b"], complete: true });
  expect(
    gone(apply(live(), [{ kind: "access", family: "project", id: "a", access: "denied" }])),
  ).toBe(false);
});
