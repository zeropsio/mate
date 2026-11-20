import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { liveProjects, ORG, projectValue, zeropsVersion } from "./__fixtures__/account.ts";
import { detailScopeOf, type DetailDemand } from "./demand.ts";
import { membershipInputs } from "./__fixtures__/membership.ts";
import { placementsScope } from "./families/hqNavigation.ts";
import { projectsScope } from "./families/project.ts";
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

// witness: packages/client-runtime/src/data/placedRows.ts | if (!listed.has(id) || reading) return false; → if (named.has(id)) return false;
it("ST+1: A No-access person's Mate whose listing names no grant of theirs has its own row read once, by the account, and one Zerops is verifying gone is not read a second time; breaks: a person with a project grant sees no Read-only or Open, or a demotion reads each Mate twice", () => {
  const roster = projectsScope(ORG);
  const hold = (store: AccountStore) => {
    const demands: DetailDemand[] = [];
    const stop = holdPlacedProjectRows({
      store,
      orgId: ORG,
      demandDetail: (demand) => {
        demands.push(demand);
        return () => {};
      },
    });
    return { demands, stop };
  };
  // A No-access person: Zerops' search lists the Mate without naming their grant.
  const guestAccount = () => {
    const store = makeAccountStore(AtomRegistry.make());
    for (const input of liveProjects(ORG, [{ id: "nova" }])) store.dispatch(input);
    for (const input of membershipInputs("NO_ACCESS")) store.dispatch(input);
    placements(store, ["nova"]);
    return store;
  };

  const listedOnly = guestAccount();
  const own = hold(listedOnly);
  expect(own.demands).toEqual([{ family: "project", listing: "project", ownerId: "nova" }]);
  // The own row read names no grant in a listing either: the one hold stays the one read.
  answerOwnRow(listedOnly, own.demands[0]!, "read");
  expect(own.demands).toHaveLength(1);
  own.stop();

  // Demoted: the roster read again still lists the Mate while `/user/info` already says No access.
  const rereading = guestAccount();
  rereading.dispatch({ kind: "baseline-begin", scope: roster, generation: 1 });
  const whileRead = hold(rereading);
  expect(whileRead.demands).toEqual([]);
  whileRead.stop();

  // The roster dropped it: Zerops verifies it gone, then refuses it.
  const leaving = guestAccount();
  leaving.dispatch({
    kind: "membership",
    scope: roster,
    generation: 1,
    delta: { add: [], remove: ["nova"] },
  });
  const verifying = hold(leaving);
  expect(verifying.demands).toEqual([]);
  leaving.dispatch({ kind: "access", family: "project", id: "nova", access: "denied" });
  expect(verifying.demands).toEqual([]);
  verifying.stop();
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
