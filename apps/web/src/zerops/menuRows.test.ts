import {
  accountReadsAtom,
  makeAccountStore,
  type AccountStore,
  type HqVerdict,
} from "@t3tools/client-runtime/data";
import { seedHqVerdict } from "@t3tools/client-runtime/data/fixtures";
import { buildZeropsGroupTree, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { menuRowsAtom, type MenuRows } from "./menuRows";

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
    seedHqVerdict(store, ORG, "official");
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

  it("on a first sign-in, waits for whether the organization has an HQ before it draws", () => {
    const registry = AtomRegistry.make();
    const atom = menuRowsAtom(ORG, []);
    // The listing lands before the member list says whether there is an official HQ.
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    const frames: MenuRows[] = [registry.get(atom)];
    seedHqVerdict(store, ORG, "official");
    hqLink(store, undefined);
    frames.push(registry.get(atom));
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    const settled = registry.get(atom);

    expect(settled.settled).toBe(true);
    expect(settled.rows.map(({ project }) => project.hq !== undefined)).toEqual([true, true]);
    for (const frame of frames) expect(frame).toEqual({ settled: false, rows: [] });
  });

  type Outcome = "transient" | "definitive-refusal";
  /**
   * HQ's link and its navigation scope demanded, as the account opens them for an official HQ;
   * its first attempt ended so where `outcome` says.
   */
  const hqLink = (store: AccountStore, outcome: Outcome | undefined) => {
    const link = `hq:${ORG}` as const;
    const apps = `hq:${ORG}:hq-apps` as const;
    for (const key of [link, apps])
      store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    if (outcome === undefined) return;
    const message = outcome === "transient" ? "closed" : "403";
    store.dispatch({
      kind: "stream",
      key: link,
      now: 0,
      event: { kind: "fault", jitter: 0, fault: { outcome, message } },
    });
  };

  it.each([
    { case: "the HQ verdict undecided", verdict: "pending", drawn: false },
    { case: "no official HQ", verdict: "none", drawn: true },
    { case: "the member list unreadable", verdict: "unreadable", drawn: true },
    {
      case: "an official HQ's first read under way",
      verdict: "official",
      hq: "open",
      drawn: false,
    },
    {
      case: "an official HQ's first attempt failed",
      verdict: "official",
      hq: "transient",
      drawn: true,
    },
    { case: "an official HQ refused", verdict: "official", hq: "definitive-refusal", drawn: true },
  ] satisfies ReadonlyArray<{
    case: string;
    verdict: HqVerdict;
    hq?: Outcome | "open";
    drawn: boolean;
  }>)("with the listing read, $case: drawn $drawn", ({ verdict, hq, drawn }) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [ADA, ZOE]);
    seedHqVerdict(store, ORG, verdict);
    if (hq !== undefined) hqLink(store, hq === "open" ? undefined : hq);
    const frame = registry.get(menuRowsAtom(ORG, []));
    expect(frame.settled).toBe(drawn);
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
    seedHqVerdict(store, ORG, "official");
    mountHqNavigation(registry, ORG, { structure: STRUCTURE }, store);
    expect(registry.get(menuRowsAtom(ORG, []))).toEqual({ settled: false, rows: [] });
  });
});
