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
function readRuntime(): ManagedZeropsDataRuntime {
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
      { list: [PROJECT], totalCount: 1 },
      "direct-read",
    ),
  );
  const services = {
    kind: "services-of-project" as const,
    project: owner,
    schemaVersion: 1 as const,
  };
  ingest(
    decodeEntityQueryResponse(
      services,
      directTicket({ kind: "query", descriptor: services }, id, 3, 3),
      { list: [ZCP], totalCount: 1 },
      "direct-read",
    ),
  );
  const granted = {
    machine: {
      phase: { phase: "granted", evidence: { account: { organizations: [{ organization }] } } },
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
