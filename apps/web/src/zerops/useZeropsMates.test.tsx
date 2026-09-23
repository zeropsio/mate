import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
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
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { zeropsDataRuntimeAtom, zeropsInventoryAtom, zeropsSessionAtom } from "../state/zerops";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  project,
  scope,
  stamp,
} from "./__fixtures__/platformData";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { zeropsMateAt } from "./mateIdentities";
import { zeropsEnvironmentNamesAtom } from "./useZeropsEnvironmentNames";
import { zeropsMatesAtom } from "./useZeropsMates";

const environments = vi.hoisted(() => ({
  atom: null as unknown as Atom.Writable<ReadonlyMap<string, unknown>>,
}));

vi.mock("../state/presentation", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  environments.atom = Atom.make<ReadonlyMap<string, unknown>>(new Map());
  return { environmentPresentations: { presentationsAtom: environments.atom } };
});

const FEN = EnvironmentId.make("environment-fen");
const ELSEWHERE = EnvironmentId.make("environment-elsewhere");
const OUTSIDE = EnvironmentId.make("environment-outside");
const FEN_ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";

const owner = project();
const PROJECT: ZeropsProject = {
  id: owner.projectId,
  clientId: owner.organization.organizationId,
  name: "kanban",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
  tagList: ["mate:bot:Fen"],
};
const ZCP: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

/** A registered environment as the connection catalog presents it. */
function registered(input: {
  readonly url: string;
  readonly zerops: { readonly projectId: string } | null;
}): EnvironmentPresentation {
  return {
    entry: { target: { _tag: "PrimaryConnectionTarget", httpBaseUrl: input.url } },
    connection: { phase: "connected", error: null, traceId: null },
    serverConfig: {
      environment: input.zerops === null ? {} : { zerops: input.zerops },
    },
  } as unknown as EnvironmentPresentation;
}

/** A runtime that has read the organization's one project and its zcp container. */
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
  return {
    reads: createZeropsDataAtoms(Atom.make(state)).reads,
  } as unknown as ManagedZeropsDataRuntime;
}

/** What the account's product publishes once its inventory is granted. */
function publishAccount(registry: AtomRegistry.AtomRegistry) {
  registry.set(zeropsDataRuntimeAtom, readRuntime());
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
  });
}

const whoLivesAt = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) =>
  zeropsMateAt(registry.get(zeropsMatesAtom), environmentId).kind;

/** An account opens in this renderer, over the environments it has registered. */
function openAccount(userId: string) {
  openAccountLifetime(userId);
  appAtomRegistry.set(
    environments.atom,
    new Map<string, unknown>([
      [FEN, registered({ url: `${FEN_ORIGIN}/mate`, zerops: { projectId: owner.projectId } })],
      [
        ELSEWHERE,
        registered({
          url: "https://zcp-99aa-8080.prg1.zerops.app/mate",
          zerops: { projectId: "project-9" },
        }),
      ],
      [OUTSIDE, registered({ url: "http://localhost:3773", zerops: null })],
    ]),
  );
}

afterEach(() => {
  closeAccountLifetime();
});

describe("who lives in each environment, derived", () => {
  it("an environment the list has not reached is unknown, never nobody", () => {
    openAccount("user-a");
    publishAccount(appAtomRegistry);

    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("mate");
    // Another organization's Mate: its list has not been read.
    expect(whoLivesAt(appAtomRegistry, ELSEWHERE)).toBe("unknown");
    // A server that says it runs outside Zerops holds nobody without any list.
    expect(whoLivesAt(appAtomRegistry, OUTSIDE)).toBe("nobody");
  });

  it("a new sign-in never sees the previous account's names or Mates", () => {
    openAccount("user-a");
    publishAccount(appAtomRegistry);
    expect(appAtomRegistry.get(zeropsEnvironmentNamesAtom)?.get(FEN)).toBe("kanban");
    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("mate");

    openAccount("user-b");

    expect(appAtomRegistry.get(zeropsEnvironmentNamesAtom)).toBeNull();
    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("unknown");
  });

  it.each<{
    readonly name: string;
    readonly environmentId: EnvironmentId;
    readonly kind: string;
  }>([
    { name: "a server that runs outside Zerops", environmentId: OUTSIDE, kind: "nobody" },
    { name: "a server that runs in Zerops", environmentId: FEN, kind: "unknown" },
    {
      name: "a server that has not answered",
      environmentId: EnvironmentId.make("environment-unregistered"),
      kind: "unknown",
    },
  ])("before the candidate list is read, reads $kind for $name", ({ environmentId, kind }) => {
    openAccount("user-a");

    expect(whoLivesAt(appAtomRegistry, environmentId)).toBe(kind);
  });
});
