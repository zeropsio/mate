import {
  accountReadsAtom,
  makeAccountStore,
  projectsScope,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import { buildZeropsGroupTree, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { menuRowsAtom, type MenuRows } from "./menuRows";
import { zeropsSessionAtom } from "../state/zerops";
import { organization } from "./__fixtures__/platformData";
import { candidateListingAtom, detailCandidateListingAtom } from "./useZeropsCandidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";

const ORG = "org-example";

/** Two projects whose names and creation dates order them opposite ways. */
const ADA: ZeropsProject = {
  id: "p-ada",
  name: "Bakery - Ada",
  status: "ACTIVE",
  clientId: ORG,
  created: "2026-09-01T10:00:00.000Z",
};
const ZOE: ZeropsProject = {
  id: "p-zoe",
  name: "Shop - Zoe",
  status: "ACTIVE",
  clientId: ORG,
  created: "2026-10-01T10:00:00.000Z",
};

const STRUCTURE: HqStructure = {
  ungrouped: [],
  apps: [
    {
      id: "app-a",
      name: "Bakery",
      projects: [{ projectId: ADA.id, name: ADA.name, kind: "mate", mate: { face: "" } }],
    },
    {
      id: "app-h",
      name: "Shop",
      projects: [{ projectId: ZOE.id, name: ZOE.name, kind: "mate", mate: { face: "" } }],
    },
  ],
};

/** The projects in the order the menu draws them: its one rule, newest first. */
const drawnOrder = (frame: MenuRows) =>
  buildZeropsGroupTree(frame.rows, { order: "newest" }).groups.flatMap(({ environments }) =>
    environments.map(({ item }) => item.project.id),
  );

describe("menuRowsAtom", () => {
  it("draws nothing until both HQ's navigation and the project listing landed, then one order", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    const atom = menuRowsAtom(ORG, []);
    const frames: MenuRows[] = [registry.get(atom)];
    frames.push(registry.get(atom));
    // The live order of a cold load: HQ's navigation answers first, the listing after it.
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    frames.push(registry.get(atom));
    mountRoster(registry, ORG, [ADA, ZOE], { into: store });
    frames.push(registry.get(atom));

    const settled = frames.at(-1)!;
    expect(settled.settled).toBe(true);
    expect(drawnOrder(settled)).toEqual([ZOE.id, ADA.id]);
    for (const frame of frames.slice(0, -1)) {
      expect(frame).toEqual({ settled: false, rows: [] });
    }
  });

  type Outcome = "transient" | "definitive-refusal" | "slow";
  /**
   * HQ's link and its navigation scope demanded, as the account opens them for an official HQ;
   * its first attempt ended so where `outcome` says — `slow`: connected, the navigation asked and
   * not answered past its patience.
   */
  const hqLink = (store: AccountStore, outcome: Outcome | undefined) => {
    const link = `hq:${ORG}` as const;
    const apps = `hq:${ORG}:hq-apps` as const;
    for (const key of [link, apps])
      store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    if (outcome === undefined) return;
    if (outcome === "slow") {
      for (const [key, event] of [
        [link, { kind: "handshake" }],
        [apps, { kind: "attempt" }],
        [apps, { kind: "handshake" }],
        [apps, { kind: "grace-over", since: 0 }],
      ] as const)
        store.dispatch({ kind: "stream", key, now: 0, event });
      return;
    }
    const message = outcome === "transient" ? "closed" : "403";
    store.dispatch({
      kind: "stream",
      key: link,
      now: 0,
      event: { kind: "fault", jitter: 0, fault: { outcome, message } },
    });
  };

  it.each([
    { case: "HQ's link not yet demanded", drawn: false },
    {
      case: "an official HQ's first read under way",
      hq: "open",
      drawn: false,
    },
    {
      case: "an official HQ's first attempt failed, inside the wait",
      hq: "transient",
      drawn: false,
    },
    {
      case: "an official HQ's first attempt failed and the wait ran out",
      hq: "transient",
      waitedOut: true,
      drawn: true,
    },
    {
      case: "an official HQ slow to answer, inside the wait",
      hq: "slow",
      drawn: false,
    },
    {
      case: "an official HQ slow to answer and the wait ran out",
      hq: "slow",
      waitedOut: true,
      drawn: true,
    },
    { case: "an official HQ refused", hq: "definitive-refusal", drawn: true },
  ] satisfies ReadonlyArray<{
    case: string;
    hq?: Outcome | "open";
    waitedOut?: boolean;
    drawn: boolean;
  }>)("with the listing read, $case: drawn $drawn", ({ hq, waitedOut, drawn }) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    if (hq !== undefined) hqLink(store, hq === "open" ? undefined : hq);
    const frame = registry.get(
      menuRowsAtom(ORG, [], { waitedOut: waitedOut === true, drawn: false }),
    );
    expect(frame.settled).toBe(drawn);
  });

  /** HQ's link tries again after its failed attempt: its next attempt is under way. */
  const hqRetries = (store: AccountStore) =>
    store.dispatch({ kind: "stream", key: `hq:${ORG}`, now: 1_000, event: { kind: "retry-due" } });

  it("A first HQ hiccup holds the menu instead of drawing the names alone", () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    const atom = menuRowsAtom(ORG, []);
    hqLink(store, "transient");
    const frames: MenuRows[] = [registry.get(atom)];
    hqRetries(store);
    frames.push(registry.get(atom));
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    const settled = registry.get(atom);

    for (const frame of frames) expect(frame).toEqual({ settled: false, rows: [] });
    expect(settled.settled).toBe(true);
    expect(settled.rows.map(({ project }) => project.hq !== undefined)).toEqual([true, true]);
  });

  it("A first Zerops hiccup holds the menu instead of drawing it empty", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    const link = `zerops:${ORG}` as const;
    for (const key of [link, projectsScope(ORG)])
      store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    store.dispatch({
      kind: "stream",
      key: link,
      now: 0,
      event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "closed" } },
    });
    const atom = menuRowsAtom(ORG, []);
    expect(registry.get(atom)).toEqual({ settled: false, rows: [] });
    mountRoster(registry, ORG, [ADA, ZOE], { into: store });
    expect(drawnOrder(registry.get(atom))).toEqual([ZOE.id, ADA.id]);
  });

  it("The menu paints its rows once each Mate's last words are read, not before", () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    const atom = menuRowsAtom(ORG, []);
    mountHqNavigation(
      registry,
      ORG,
      { structure: STRUCTURE, attentionUnanswered: [ADA.id, ZOE.id] },
      store,
    );
    const waiting = registry.get(atom);
    mountHqNavigation(
      registry,
      ORG,
      { structure: STRUCTURE, attentionUnanswered: [ZOE.id] },
      store,
    );
    const half = registry.get(atom);
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);

    expect(waiting).toEqual({ settled: false, rows: [] });
    expect(half).toEqual({ settled: false, rows: [] });
    expect(drawnOrder(registry.get(atom))).toEqual([ZOE.id, ADA.id]);
  });

  it("A Mate whose last words have not come by the wait's end paints without them", () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    mountHqNavigation(
      registry,
      ORG,
      { structure: STRUCTURE, attentionUnanswered: [ZOE.id] },
      store,
    );
    const frame = registry.get(menuRowsAtom(ORG, [], { waitedOut: true, drawn: false }));
    expect(drawnOrder(frame)).toEqual([ZOE.id, ADA.id]);
  });

  it("Rows once drawn stay while HQ reads again", () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    hqLink(store, "transient");
    // HQ did not answer within the wait: the projects stand by their names alone.
    const fallback = registry.get(menuRowsAtom(ORG, [], { waitedOut: true, drawn: false }));
    hqRetries(store);
    const rereading = registry.get(menuRowsAtom(ORG, [], { waitedOut: true, drawn: true }));

    expect(fallback.settled).toBe(true);
    expect(rereading).toEqual(fallback);
  });

  it("draws nothing while the listing is unread, whatever HQ said", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    expect(registry.get(menuRowsAtom(ORG, []))).toEqual({ settled: false, rows: [] });
  });
});

describe("personal Chiefs in the menu data", () => {
  it("the Mates list excludes every Chief even when HQ placements arrive after the roster", () => {
    const registry = AtomRegistry.make();
    const own = { ...ADA, id: "own-chief", name: "Chief · Ada", tagList: ["mate", "chief"] };
    const other = { ...ZOE, id: "other-chief", name: "Chief · Zoe", tagList: ["mate", "chief"] };
    const store = mountRoster(registry, ORG, [ADA, own, other]);
    const atom = menuRowsAtom(ORG, []);
    expect(registry.get(atom).rows).toEqual([]);
    mountHqNavigation(
      registry,
      ORG,
      {
        structure: {
          ...STRUCTURE,
          apps: [
            STRUCTURE.apps[0]!,
            ...[own, other].map((chief) => ({
              id: `app-${chief.id}`,
              name: chief.name,
              projects: [
                {
                  projectId: chief.id,
                  name: chief.name,
                  kind: "mate" as const,
                  mate: { face: "" },
                },
              ],
            })),
          ],
        },
      },
      store,
    );
    expect(registry.get(atom).rows.map(({ project }) => project.id)).toEqual([ADA.id]);
    store.close();
    registry.dispose();
  });
});

it("known Mate details include only ordinary Mates and the person's own Chief", () => {
  const registry = AtomRegistry.make();
  const orgId = organization.organizationId;
  const projects = [
    { ...ADA, id: "ordinary", clientId: orgId },
    { ...ADA, id: "own-chief", clientId: orgId, tagList: ["mate", "chief"] },
    { ...ADA, id: "other-chief", clientId: orgId, tagList: ["mate", "chief"] },
    { ...ADA, id: "unregistered-chief", clientId: orgId, tagList: ["mate", "chief"] },
  ];
  const store = mountRoster(registry, orgId, projects, {
    services: projects.map((project) => ({
      id: `service-${project.id}`,
      projectId: project.id,
      name: "zcp",
      status: "ACTIVE",
      subdomainAccess: true,
      ports: [{ port: 8080, httpSupport: true }],
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    })),
  });
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: organization,
  });
  mountHqNavigation(
    registry,
    orgId,
    {
      structure: {
        apps: [],
        ungrouped: projects.slice(0, 3).map((project) => ({
          projectId: project.id,
          name: project.name,
          mate: { face: "" },
        })),
      },
    },
    store,
  );
  const ids = (atom: typeof candidateListingAtom) =>
    heldCandidates(registry.get(atom)).rows.map((row) => row.project.id);
  // Before HQ attributes a Chief, a known project ID does not grant access to its detail.
  expect(ids(detailCandidateListingAtom)).toEqual(["ordinary"]);
  const scope = `hq:${orgId}:hq-placements` as const;
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
    reset: false,
    removals: [],
    rows: ["own-chief", "other-chief"].map((id) => ({
      family: "placement" as const,
      id,
      revision: { kind: "hq" as const, incarnation: "seed", revision: 100 },
      value: {
        projectId: id,
        appId: null,
        name: id,
        kind: "mate" as const,
        mate: { face: "" },
        person: {
          role: "ADMIN" as const,
          mayWrite: true,
          mine: id === "own-chief",
          ownerUserId: id,
          waitsOnViewer: false,
          unseen: null,
          chief: id === "own-chief" ? ("mine" as const) : ("another" as const),
        },
      },
    })),
  });
  expect(ids(candidateListingAtom)).toEqual(["ordinary"]);
  expect(ids(detailCandidateListingAtom)).toEqual(["ordinary", "own-chief"]);
  store.close();
  registry.dispose();
});
