import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import {
  DEFAULT_ZEROPS_DATA_POLICY,
  createZeropsDataAtoms,
  makeInitialZeropsDataState,
  projectKeyOf,
  reduceZeropsDataState,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";
import { mateListingsAtom } from "@t3tools/client-runtime/zerops/environments";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  desiredInterest,
  identity,
  organization,
  project,
  scope,
} from "../zerops/__fixtures__/platformData";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import type { InventoryProjection } from "../zerops/inventoryContext";
import {
  mateRowsAtom,
  hqMatesViewAtom,
  hqStructureAtom,
  takenBotNamesAtom,
  zeropsDataRuntimeAtom,
  zeropsInventoryAtom,
  zeropsSessionAtom,
} from "./zerops";

const mateLiveView = Schema.decodeUnknownSync(MateLiveView);

const owner = project();
const PROJECT: ZeropsProject = {
  id: owner.projectId,
  clientId: owner.organization.organizationId,
  name: "kanban",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};
const ZCP: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

/**
 * A runtime under a grant that names the organization; the organization's projects and services
 * are the account store's (`mountRoster`).
 */
function readRuntime(): ManagedZeropsDataRuntime {
  const id = identity();
  const state = reduceZeropsDataState(
    makeInitialZeropsDataState(scope()),
    { kind: "interest-upserted", interest: desiredInterest(id) },
    DEFAULT_ZEROPS_DATA_POLICY,
  ).state;
  const granted = {
    machine: {
      phase: {
        phase: "granted",
        evidence: {
          account: { organizations: [{ organization }] },
          // The grant admits the project: its services are its Mates'.
          projects: new Map([
            [
              owner.projectId,
              { access: { project: owner, role: "OWNER", mutationsAllowed: true } },
            ],
          ]),
          unverified: new Map(),
          closedProjects: new Map(),
        },
      },
    },
  };
  return {
    scope: scope(),
    reads: createZeropsDataAtoms(Atom.make(state)).reads,
    access: { view: Atom.make(granted) },
  } as unknown as ManagedZeropsDataRuntime;
}

describe("the candidate rows", () => {
  it("the web candidate rows are the account listing's rows", () => {
    const registry = AtomRegistry.make();
    const runtime = readRuntime();
    mountRoster(registry, organization.organizationId, [PROJECT], {
      services: [{ ...ZCP, projectId: PROJECT.id }],
    });
    registry.set(zeropsDataRuntimeAtom, runtime);
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    registry.set(zeropsInventoryAtom, {
      projects: [PROJECT],
      projectRefs: new Map([[projectKeyOf(owner), owner]]),
      authority: new Map(),
      account: { kind: "authorized" },
    });

    const rows = registry.get(mateRowsAtom);
    const listed = registry
      .get(mateListingsAtom(runtime))
      .find(({ organizationId }) => organizationId === organization.organizationId);

    expect(heldCandidates(rows).rows.map(({ key }) => key)).toEqual([`${PROJECT.id}:${ZCP.id}`]);
    // HQ places nothing yet: each row is the listing's own.
    expect(rows).toEqual(listed?.listing);
    expect(heldCandidates(rows).rows[0]).toBe(heldCandidates(listed!.listing).rows[0]);
  });

  it("each row carries where the organization's HQ places its project", () => {
    const registry = AtomRegistry.make();
    mountRoster(registry, organization.organizationId, [PROJECT], {
      services: [{ ...ZCP, projectId: PROJECT.id }],
    });
    registry.set(zeropsDataRuntimeAtom, readRuntime());
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    registry.set(zeropsInventoryAtom, {
      projects: [PROJECT],
      projectRefs: new Map([[projectKeyOf(owner), owner]]),
      authority: new Map(),
      account: { kind: "authorized" },
    });
    registry.set(hqStructureAtom, {
      organizationId: organization.organizationId,
      changes: null,
      appReads: null,
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "app-kanban",
            name: "Kanban",
            projects: [
              {
                projectId: PROJECT.id,
                name: PROJECT.name,
                kind: "mate",
                mate: { face: "" },
              },
            ],
          },
        ],
      },
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    });

    expect(heldCandidates(registry.get(mateRowsAtom)).rows[0]?.project.hq).toEqual({
      appId: "app-kanban",
      appName: "Kanban",
      kind: "mate",
      mate: { face: "" },
    });

    // Who signed Ada's agent in, as HQ's overview of her says it: on her row, which stays the
    // same row while what she does moves and her logins do not.
    const logins = { "claude-code": { signedInBy: "u-jan", present: true, token: false } };
    const told = (moved: boolean) =>
      mateLiveView({
        presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "live" },
        logins,
        ...(moved ? { crew: { status: "none" } } : {}),
      });
    // Read as the menu reads it: kept, not built afresh for each look.
    const unsubscribe = registry.subscribe(mateRowsAtom, () => undefined);
    registry.set(hqMatesViewAtom, {
      organizationId: organization.organizationId,
      mates: new Map([[PROJECT.id, told(false)]]),
      current: true,
    });
    const row = heldCandidates(registry.get(mateRowsAtom)).rows[0];
    expect(row?.project.hq?.mate).toEqual({ face: "", logins });
    registry.set(hqMatesViewAtom, {
      organizationId: organization.organizationId,
      mates: new Map([[PROJECT.id, told(true)]]),
      current: true,
    });
    expect(heldCandidates(registry.get(mateRowsAtom)).rows[0]).toBe(row);
    unsubscribe();
  });
});

describe("the names the organization's Mates go by", () => {
  /** Uma's project, created by someone else a moment ago: listed, not yet in the inventory. */
  const UMA: ZeropsProject = {
    id: "project-uma",
    clientId: owner.organization.organizationId,
    name: "Uma",
    status: "ACTIVE",
    tagList: ["mate"],
  };
  // D3: each Mate goes by its project's name.
  const named = { ...PROJECT, name: "Ada", tagList: ["mate"] };
  /** HQ places both Mates, in one application. */
  const STRUCTURE: HqStructure = {
    ungrouped: [],
    apps: [
      {
        id: "app-heron",
        name: "Heron",
        projects: [
          { projectId: PROJECT.id, name: "Ada", kind: "mate", mate: { face: "" } },
          { projectId: UMA.id, name: "Uma", kind: "mate", mate: { face: "" } },
        ],
      },
    ],
  };

  it.each([
    {
      label: "a list read whole, with a project the inventory does not hold yet",
      listed: [named, UMA],
      totalCount: 2,
      account: { kind: "authorized" as const },
      expected: { names: ["Ada", "Uma"], complete: true },
    },
    {
      label: "a list still partial: a name missing from it may yet be taken",
      listed: [named],
      totalCount: 2,
      account: { kind: "authorized" as const },
      expected: { names: ["Ada"], complete: false },
    },
    {
      label: "a list read whole, with HQ's structure not answered now: a name is unread",
      listed: [named, UMA],
      totalCount: 2,
      account: { kind: "authorized" as const },
      current: false,
      expected: { names: ["Ada", "Uma"], complete: false },
    },
    {
      label: "an account whose access lapsed",
      listed: [named, UMA],
      totalCount: 2,
      account: { kind: "withheld" as const, reason: "access-lapsed" as const, cause: null },
      expected: { names: [], complete: false },
    },
  ] as ReadonlyArray<{
    readonly label: string;
    readonly listed: ReadonlyArray<ZeropsProject>;
    readonly totalCount: number;
    readonly account: InventoryProjection["account"];
    readonly current?: boolean;
    readonly expected: { readonly names: ReadonlyArray<string>; readonly complete: boolean };
  }>)("$label", ({ listed, totalCount, account, current = true, expected }) => {
    const registry = AtomRegistry.make();
    mountRoster(registry, organization.organizationId, listed, {
      unreadMembers: totalCount > listed.length ? [UMA.id] : [],
    });
    registry.set(zeropsDataRuntimeAtom, readRuntime());
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    // The inventory holds only the project the last round verified.
    registry.set(zeropsInventoryAtom, {
      projects: [named],
      projectRefs: new Map([[projectKeyOf(owner), owner]]),
      authority: new Map(),
      account,
    });
    registry.set(hqStructureAtom, {
      organizationId: organization.organizationId,
      changes: null,
      appReads: null,
      structure: STRUCTURE,
      readAt: 1_000,
      current,
      unavailableSince: current ? null : 2_000,
    });

    const taken = registry.get(takenBotNamesAtom);
    expect({ names: [...taken.names].toSorted(), complete: taken.complete }).toEqual(expected);
  });
});
