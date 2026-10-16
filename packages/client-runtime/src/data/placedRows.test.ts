import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveProjects, ORG, projectValue, zeropsVersion } from "./__fixtures__/account.ts";
import { detailScopeOf, type DetailDemand } from "./demand.ts";
import { placementsScope } from "./families/hqNavigation.ts";
import type { AccountInput } from "./reducer.ts";
import { holdPlacedProjectRows } from "./placedRows.ts";
import { platformInventory } from "./projections/platformInventory.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "./store.ts";

/** A Guest: no organization role, Read on the projects they were given. */
const GUEST = { id: ORG, name: "Acme", membershipId: "C-guest", roleCode: "NO_ACCESS" };
const READ = [{ clientUserId: "C-guest", roleCode: "READ_ONLY" }];

/** HQ places these projects as Mates of the Tea Shop application. */
function placeMates(store: AccountStore, projectIds: ReadonlyArray<string>) {
  const scope = placementsScope(ORG);
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
    reset: false,
    removals: [],
    rows: projectIds.map((projectId) => ({
      family: "placement",
      id: projectId,
      revision: { kind: "hq", incarnation: "seed", revision: 1 },
      value: { projectId, appId: "tea-shop", name: projectId, kind: "mate", mate: { face: "" } },
    })),
  } as AccountInput);
}

/** What Zerops answers the project's own read, by its id: its row, or a refusal. */
function answerOwnRow(store: AccountStore, demand: DetailDemand, answer: "read" | "refused") {
  const scope = detailScopeOf(ORG, demand);
  const event = (streamEvent: object) =>
    store.dispatch({ kind: "stream", key: scope, now: 0, event: streamEvent } as AccountInput);
  event({ kind: "demand", demanded: true });
  event({ kind: "attempt" });
  event({ kind: "handshake" });
  if (answer === "refused") {
    store.dispatch({
      kind: "access",
      family: "project",
      id: demand.ownerId,
      scope,
      access: "denied",
    });
    return;
  }
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    members: [demand.ownerId],
    rows: [
      {
        family: "project",
        id: demand.ownerId,
        value: projectValue({ id: demand.ownerId, userRoles: READ }),
        revision: zeropsVersion(1),
      },
    ],
  });
  event({ kind: "baseline-committed" });
}

const listed = (store: AccountStore) =>
  platformInventory
    .derive(readsOfState(store.state()), { orgId: ORG, viewer: GUEST })
    .projects.map(({ id }) => id);

describe("holdPlacedProjectRows", () => {
  it.each<{
    readonly name: string;
    readonly answer: "read" | "refused";
    readonly listed: ReadonlyArray<string>;
  }>([
    {
      name: "a Guest given Read on a new Mate sees it without waiting for Zerops' search",
      answer: "read",
      listed: ["nova", "wren"],
    },
    {
      name: "a new Mate HQ places that Zerops refuses the Guest stays unlisted",
      answer: "refused",
      listed: ["wren"],
    },
  ])("$name", ({ answer, listed: expected }) => {
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
    placeMates(store, ["wren", "nova"]);
    expect(listed(store)).toEqual(["wren"]);
    // Only the Mate the search does not name is read by its id.
    expect(demands).toEqual([{ family: "project", listing: "project", ownerId: "nova" }]);
    answerOwnRow(store, demands[0]!, answer);
    expect(listed(store)).toEqual(expected);
    stop();
  });

  it("asks nothing of Zerops while its search has not answered, nor for a Mate it lists", () => {
    const store = makeAccountStore(AtomRegistry.make());
    const demands: DetailDemand[] = [];
    const stop = holdPlacedProjectRows({
      store,
      orgId: ORG,
      demandDetail: (demand) => {
        demands.push(demand);
        return () => {};
      },
    });
    placeMates(store, ["wren"]);
    expect(demands).toEqual([]);
    for (const input of liveProjects(ORG, [{ id: "wren", userRoles: READ }])) store.dispatch(input);
    expect(demands).toEqual([]);
    stop();
  });

  it("lets a Mate's own read go once HQ no longer places it", () => {
    const store = makeAccountStore(AtomRegistry.make());
    for (const input of liveProjects(ORG, [])) store.dispatch(input);
    const released: string[] = [];
    const stop = holdPlacedProjectRows({
      store,
      orgId: ORG,
      demandDetail: (demand) => () => released.push(demand.ownerId),
    });
    placeMates(store, ["nova"]);
    const scope = placementsScope(ORG);
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
      reset: false,
      removals: [{ family: "placement", id: "nova", reason: "deleted" }],
      rows: [],
    } as AccountInput);
    expect(released).toEqual(["nova"]);
    stop();
  });
});
