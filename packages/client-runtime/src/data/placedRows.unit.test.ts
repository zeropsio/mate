import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { liveProjects, ORG, projectValue, zeropsVersion } from "./__fixtures__/account.ts";
import { detailScopeOf, type DetailDemand } from "./demand.ts";
import { placementsScope } from "./families/hqNavigation.ts";
import type { StreamEvent } from "./streamMachine.ts";
import { holdPlacedProjectRows } from "./placedRows.ts";
import { platformInventory } from "./projections/platformInventory.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "./store.ts";

/** A Guest: no organization role, Read on the projects they were given. */
const GUEST = { id: ORG, name: "Acme", membershipId: "C-guest", roleCode: "NO_ACCESS" };
const READ = [{ clientUserId: "C-guest", roleCode: "READ_ONLY" }];

/** HQ's placement stream names the Mates it added or removed. */
function placements(store: AccountStore, added: string[], removed: string[] = []) {
  const scope = placementsScope(ORG);
  store.dispatch({
    kind: "delivery",
    scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
    via: "hq-stream",
    reset: false,
    rows: added.map((projectId) => ({
      family: "placement",
      id: projectId,
      value: { projectId, appId: "tea-shop", name: projectId, kind: "mate", mate: { face: "" } },
      revision: { kind: "hq", incarnation: "seed", revision: 1 },
    })),
    removals: removed.map((id) => ({ family: "placement", id })),
  });
}

/** Zerops answers the held scope with the Guest's row or a denial. */
function answerOwnRow(store: AccountStore, demand: DetailDemand, answer: "read" | "refused") {
  const projectId = demand.ownerId;
  const scope = detailScopeOf(ORG, demand);
  const step = (event: StreamEvent) =>
    store.dispatch({ kind: "stream", key: scope, now: 0, event });
  step({ kind: "demand", demanded: true });
  step({ kind: "attempt" });
  step({ kind: "handshake" });
  if (answer === "refused") {
    store.dispatch({ kind: "access", scope, family: "project", id: projectId, access: "denied" });
    return;
  }

  const project = {
    family: "project",
    id: projectId,
    value: projectValue({ id: projectId, userRoles: READ }),
    revision: zeropsVersion(1),
  } as const;
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    rows: [project],
    members: [projectId],
  });
  step({ kind: "baseline-committed" });
}

const listed = (store: AccountStore) =>
  platformInventory
    .derive(readsOfState(store.state()), { orgId: ORG, viewer: GUEST })
    .projects.map(({ id }) => id);

// witness: packages/client-runtime/src/data/placedRows.ts | if (organizationProjects.derive(read, orgId).read !== "read") return []; → if (organizationProjects.derive(read, orgId).read !== "read" || read.members(projectsScope(orgId)).ids.length > 0) return [];
it("ST37: A Mate HQ places that Zerops' search has not listed is read by its own id: a Guest given Read sees it at once, and one Zerops refuses stays unlisted", () => {
  for (const { answer, expected } of [
    { answer: "read", expected: ["nova", "wren"] },
    { answer: "refused", expected: ["wren"] },
  ] as const) {
    const store = makeAccountStore(AtomRegistry.make());
    // Zerops' search lists the Mate the Guest had; the new one it has not indexed yet.
    for (const input of liveProjects(ORG, [{ id: "wren", userRoles: READ }])) store.dispatch(input);
    const demands: DetailDemand[] = [];
    const stop = holdPlacedProjectRows({
      store,
      orgId: ORG,
      demandDetail: (demand) => {
        demands.push(demand);
        return () => {};
      },
    });
    placements(store, ["wren", "nova"]);
    expect(listed(store)).toEqual(["wren"]);
    // Only the Mate the search does not name is read by its id.
    expect(demands).toEqual([{ family: "project", listing: "project", ownerId: "nova" }]);
    answerOwnRow(store, demands[0]!, answer);
    expect(listed(store)).toEqual(expected);
    stop();
  }
});

// witness: packages/client-runtime/src/data/placedRows.ts | if (!placed.has(projectId)) { → if (placed.size > 0 && !placed.has(projectId)) {
it("ST38: A Mate's own read is let go once HQ no longer places it", () => {
  const store = makeAccountStore(AtomRegistry.make());
  for (const input of liveProjects(ORG, [])) store.dispatch(input);
  const released: string[] = [];
  const stop = holdPlacedProjectRows({
    store,
    orgId: ORG,
    demandDetail: (demand) => () => released.push(demand.ownerId),
  });
  placements(store, ["nova"]);
  placements(store, [], ["nova"]);
  expect(released).toEqual(["nova"]);
  stop();
});
