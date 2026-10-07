import { projectsScope } from "@t3tools/client-runtime/data";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { heldCandidateRowsAtom } from "./useZeropsCandidates";
import { projectTopologyViewAtom, environmentProjectsAtom } from "../state/zerops";
import { zeropsSessionAtom } from "../state/zerops";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { organization, project } from "./__fixtures__/platformData";
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

/**
 * A runtime that has read the project's zcp container, under a grant that names the
 * organization.
 */

/** What the account's product publishes once its inventory is granted; its store's roster. */
function publishAccount(registry: AtomRegistry.AtomRegistry) {
  const store = mountRoster(registry, organization.organizationId, [PROJECT], {
    services: [{ ...ZCP, projectId: PROJECT.id }],
  });
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: organization,
  });
  return store;
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
  it("transport recovery never republishes a chat's Mate identity, but an owner rename does", () => {
    openAccount("user-a");
    const store = publishAccount(appAtomRegistry);
    let renders = 0;
    const stop = appAtomRegistry.subscribe(zeropsMatesAtom, () => renders++);
    const before = appAtomRegistry.get(zeropsMatesAtom);
    const topology = projectTopologyViewAtom(owner);
    const contentAtoms: ReadonlyArray<Atom.Atom<unknown>> = [
      heldCandidateRowsAtom,
      topology,
      environmentProjectsAtom,
    ];
    let contentRenders = 0;
    const stops = contentAtoms.map((atom) =>
      appAtomRegistry.subscribe(atom, () => contentRenders++),
    );
    const contentBefore = contentAtoms.map((atom) => appAtomRegistry.get(atom));
    contentRenders = 0;
    renders = 0;
    const orgId = organization.organizationId;
    const scope = projectsScope(orgId);
    store.dispatch({
      kind: "stream",
      key: `zerops:${orgId}`,
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "socket closed" },
      },
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } });
    store.dispatch({
      kind: "stream",
      key: `zerops:${orgId}`,
      now: 0,
      event: { kind: "retry-due" },
    });
    store.dispatch({
      kind: "stream",
      key: `zerops:${orgId}`,
      now: 0,
      event: { kind: "handshake" },
    });
    store.dispatch({
      kind: "stream",
      key: `zerops:${orgId}`,
      now: 0,
      event: { kind: "baseline-committed" },
    });
    expect(appAtomRegistry.get(zeropsMatesAtom)).toBe(before);
    expect(renders).toBe(0);
    expect(contentRenders).toBe(0);
    contentAtoms.forEach((atom, index) =>
      expect(appAtomRegistry.get(atom)).toBe(contentBefore[index]),
    );
    const held = appAtomRegistry.get(store.data.fact("project", PROJECT.id));
    if (held.kind !== "known") throw new Error("The roster did not read the project");
    store.dispatch({
      kind: "rows",
      scope,
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "project",
          id: PROJECT.id,
          value: { ...held.value, name: "renamed" },
          revision: { kind: "zerops", version: 2 },
        },
      ],
    });
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe("renamed");
    expect(renders).toBe(1);
    expect(contentRenders).toBe(2);
    stops.forEach((stop) => stop());
    stop();
  });

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
