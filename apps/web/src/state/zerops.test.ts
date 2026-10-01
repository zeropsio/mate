import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import {
  DEFAULT_ZEROPS_DATA_POLICY,
  createZeropsDataAtoms,
  decodeEntityQueryResponse,
  makeInitialZeropsDataState,
  projectKeyOf,
  reduceZeropsDataState,
  type ManagedZeropsDataRuntime,
  type ProtocolDecodeResult,
} from "@t3tools/client-runtime/zerops/data";
import { candidateListingsAtom } from "@t3tools/client-runtime/zerops/environments";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  project,
  scope,
  stamp,
} from "../zerops/__fixtures__/platformData";
import {
  candidateRowsAtom,
  takenBotNamesAtom,
  zeropsDataRuntimeAtom,
  zeropsInventoryAtom,
  zeropsSessionAtom,
} from "./zerops";

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
 * A runtime that has read the organization's one project and its zcp container, under a grant
 * that names the organization.
 */
function readRuntime(
  listed: ReadonlyArray<ZeropsProject> = [PROJECT],
  totalCount: number = listed.length,
): ManagedZeropsDataRuntime {
  const id = identity();
  let state = reduceZeropsDataState(
    makeInitialZeropsDataState(scope()),
    { kind: "interest-upserted", interest: desiredInterest(id) },
    DEFAULT_ZEROPS_DATA_POLICY,
  ).state;
  let ordinal = 1;
  const ingest = (decoded: ProtocolDecodeResult) => {
    for (const input of decoded.observations) {
      state = reduceZeropsDataState(
        state,
        {
          kind: "observation",
          observation: { input, stamp: stamp(++ordinal), accessEvidence: null },
        },
        DEFAULT_ZEROPS_DATA_POLICY,
      ).state;
    }
  };
  const projects = {
    kind: "projects-of-organization" as const,
    organization,
    statuses: [],
    schemaVersion: 1 as const,
  };
  ingest(
    decodeEntityQueryResponse(
      projects,
      directTicket({ kind: "query", descriptor: projects }, id, 2, 2),
      { list: [...listed], totalCount },
      "direct-read",
    ),
  );
  const services = {
    kind: "services-of-organization" as const,
    organization: owner.organization,
    schemaVersion: 1 as const,
  };
  ingest(
    decodeEntityQueryResponse(
      services,
      directTicket({ kind: "query", descriptor: services }, id, 3, 3),
      { list: [{ ...ZCP, projectId: owner.projectId }], totalCount: 1 },
      "direct-read",
    ),
  );
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
    reads: createZeropsDataAtoms(Atom.make(state)).reads,
    access: { view: Atom.make(granted) },
  } as unknown as ManagedZeropsDataRuntime;
}

describe("the candidate rows", () => {
  it("the web candidate rows are the account listing's rows", () => {
    const registry = AtomRegistry.make();
    const runtime = readRuntime();
    registry.set(zeropsDataRuntimeAtom, runtime);
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    registry.set(zeropsInventoryAtom, {
      projects: [PROJECT],
      services: new Map([[PROJECT.id, { status: "resolved" as const, services: [ZCP] }]]),
      projectRefs: new Map([[projectKeyOf(owner), owner]]),
      authority: new Map(),
      account: { kind: "authorized" },
    });

    const rows = registry.get(candidateRowsAtom);
    const listed = registry
      .get(candidateListingsAtom(runtime))
      .find(({ organizationId }) => organizationId === organization.organizationId);

    expect(heldCandidates(rows).rows.map(({ key }) => key)).toEqual([`${PROJECT.id}:${ZCP.id}`]);
    expect(rows).toBe(listed?.listing);
  });
});

describe("the names the organization's Mates go by", () => {
  /** Uma's project, created by someone else a moment ago: listed, not yet in the inventory. */
  const UMA: ZeropsProject = {
    id: "project-uma",
    clientId: owner.organization.organizationId,
    name: "heron uma",
    status: "ACTIVE",
    tagList: ["mate", "mate:bot:Uma"],
  };
  const named = { ...PROJECT, tagList: ["mate", "mate:bot:Ada"] };

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
      label: "an account whose access lapsed",
      listed: [named, UMA],
      totalCount: 2,
      account: { kind: "withheld" as const, reason: "access-lapsed" as const, cause: null },
      expected: { names: [], complete: false },
    },
  ])("$label", ({ listed, totalCount, account, expected }) => {
    const registry = AtomRegistry.make();
    registry.set(zeropsDataRuntimeAtom, readRuntime(listed, totalCount));
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    // The inventory holds only the project the last round verified.
    registry.set(zeropsInventoryAtom, {
      projects: [named],
      services: new Map([[PROJECT.id, { status: "resolved" as const, services: [ZCP] }]]),
      projectRefs: new Map([[projectKeyOf(owner), owner]]),
      authority: new Map(),
      account,
    });

    const taken = registry.get(takenBotNamesAtom);
    expect({ names: [...taken.names].toSorted(), complete: taken.complete }).toEqual(expected);
  });
});
