import { seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
import {
  hqMateScope,
  projectsScope,
  readsOfState,
  shownHqMateIdentitiesAtom,
} from "@t3tools/client-runtime/data";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { heldCandidateRowsAtom } from "./useZeropsCandidates";
import { projectTopologyViewAtom, environmentProjectsAtom } from "../state/zerops";
import { environmentPresentations } from "../state/presentation";
import { zeropsSessionAtom } from "../state/zerops";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { organization, project } from "./__fixtures__/platformData";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { zeropsMateAt } from "./mateIdentities";
import { zeropsEnvironmentNamesAtom } from "./useZeropsEnvironmentNames";
import { zeropsMatesAtom } from "./useZeropsMates";
import { writeMateMemory } from "./mateIdentityMemory";

const environments = Atom.make<ReadonlyMap<EnvironmentId, EnvironmentPresentation>>(new Map());
let previousPresentations: typeof environmentPresentations.presentationsAtom;

beforeEach(() => {
  previousPresentations = environmentPresentations.presentationsAtom;
  environmentPresentations.presentationsAtom = environments;
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
function publishAccount(registry: AtomRegistry.AtomRegistry, withHq = true) {
  const store = mountRoster(registry, organization.organizationId, [PROJECT], {
    services: [{ ...ZCP, projectId: PROJECT.id }],
  });
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: organization,
  });
  if (withHq) seedMate(store, PROJECT.name);
  return store;
}

function seedMate(store: ReturnType<typeof mountRoster>, name: string) {
  seedHqNavigation(store, organization.organizationId, {
    structure: {
      apps: [],
      ungrouped: [{ projectId: PROJECT.id, name, mate: { face: "sky:seal" } }],
    },
    mates: {
      [PROJECT.id]: {
        presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
        identity: { environmentId: FEN, serverVersion: "0.14.43", update: null },
      },
    },
  });
}

const whoLivesAt = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) =>
  zeropsMateAt(registry.get(zeropsMatesAtom), environmentId).kind;

/** An account opens in this renderer, over the environments it has registered. */
function openAccount(userId: string) {
  openAccountLifetime(userId);
  appAtomRegistry.set(
    environments,
    new Map<EnvironmentId, EnvironmentPresentation>([
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
  environmentPresentations.presentationsAtom = previousPresentations;
  vi.unstubAllGlobals();
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
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe(PROJECT.name);
    seedMate(store, "renamed");
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe("renamed");
    expect(renders).toBe(1);
    expect(contentRenders).toBe(2);
    stops.forEach((stop) => stop());
    stop();
  });

  it("a remembered conversation keeps its Mate through navigation, overview arrival and an owner rename", () => {
    openAccount("identity-hold");
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    publishAccount(appAtomRegistry);
    const held = appAtomRegistry.get(shownHqMateIdentitiesAtom)[PROJECT.id]!;
    writeMateMemory({ [FEN]: held });
    // A reload has complete navigation before the separately observed overview.
    const reloaded = publishAccount(appAtomRegistry, false);
    seedHqNavigation(reloaded, organization.organizationId, {
      structure: {
        apps: [],
        ungrouped: [{ projectId: PROJECT.id, name: "Cyd", mate: { face: "rose:seal" } }],
      },
    });
    expect(
      appAtomRegistry.get(zeropsMatesAtom).get(FEN),
      "ASSERTION: navigation preserves the conversation's remembered environment and uses HQ's current name and face",
    ).toMatchObject({ name: "Cyd", tint: "rose", shape: "seal", environmentId: FEN });
    seedMate(reloaded, "Cyd");
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe("Cyd");
    const scope = `hq:${organization.organizationId}:hq-placements` as const;
    reloaded.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: reloaded.state().streams.get(scope)?.generation ?? 0 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: PROJECT.id, reason: "deleted" }],
    });
    expect(
      appAtomRegistry.get(zeropsMatesAtom).has(FEN),
      "ASSERTION: complete navigation forgets a genuinely removed project",
    ).toBe(false);
  });

  it("a still-listed Mate keeps its remembered identity while HQ cannot name its project", () => {
    openAccount("identity-unnamed");
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const store = publishAccount(appAtomRegistry);
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe(PROJECT.name);
    seedMate(store, "");
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe(PROJECT.name);
    seedMate(store, "renamed");
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe("renamed");
    const scope = `hq:${organization.organizationId}:hq-placements` as const;
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: PROJECT.id, reason: "deleted" }],
    });
    expect(appAtomRegistry.get(zeropsMatesAtom).has(FEN)).toBe(false);
  });

  it("a still-listed Mate keeps its remembered environment while HQ names its new application", () => {
    openAccount("identity-moved");
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const store = publishAccount(appAtomRegistry);
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe(PROJECT.name);
    // HQ moves the Mate into an application whose own row is still on its way: the Mate is still
    // listed, but HQ cannot name it until that row lands.
    const placement = readsOfState(store.state()).fact("placement", PROJECT.id);
    if (placement.kind !== "known") throw new Error("the Mate's placement is read");
    const scope = `hq:${organization.organizationId}:hq-placements` as const;
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
      reset: false,
      rows: [
        {
          family: "placement",
          id: PROJECT.id,
          revision: { kind: "hq", incarnation: "seed", revision: 1_000 },
          value: { ...(placement.value as object), appId: "app-on-its-way", kind: "mate" },
        },
      ],
      removals: [],
    });
    expect(
      appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.projectId,
      "ASSERTION: the Mate HQ still places keeps its conversation's environment",
    ).toBe(PROJECT.id);
    // The next visit paints it from memory as well.
    expect(
      Object.keys(JSON.parse([...storage.values()].find((v) => v.includes(FEN)) ?? "{}")),
    ).toEqual([FEN]);
  });

  it("a still-listed Mate HQ cannot name yet moves to the environment its overview names now", () => {
    openAccount("identity-relayed");
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const store = publishAccount(appAtomRegistry);
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.name).toBe(PROJECT.name);
    const reads = () => readsOfState(store.state());
    const placement = reads().fact("placement", PROJECT.id);
    const mate = reads().fact("hqMate", PROJECT.id);
    if (placement.kind !== "known" || mate.kind !== "known" || mate.value.overview === null)
      throw new Error("the Mate and its overview are read");
    const overview = mate.value.overview;
    const deliver = (scope: string, family: string, value: object) =>
      store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        scopes: [
          {
            scope: scope as never,
            generation: store.state().streams.get(scope as never)?.generation ?? 0,
          },
        ],
        reset: false,
        rows: [
          {
            family: family as never,
            id: PROJECT.id,
            revision: { kind: "hq", incarnation: "seed", revision: (revision += 1) },
            value: value as never,
          },
        ],
        removals: [],
      });
    let revision = 1_000;
    // HQ cannot name the Mate while its new application's row is on its way.
    deliver(`hq:${organization.organizationId}:hq-placements`, "placement", {
      ...placement.value,
      appId: "app-on-its-way",
      kind: "mate",
    });
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.projectId).toBe(PROJECT.id);
    // Its overview now names the environment of its re-created container.
    deliver(hqMateScope(organization.organizationId, PROJECT.id), "hqMate", {
      ...mate.value,
      overview: { ...overview, identity: { ...overview.identity, environmentId: ELSEWHERE } },
    });
    const directory = appAtomRegistry.get(zeropsMatesAtom);
    expect(
      [directory.get(ELSEWHERE)?.projectId, directory.has(FEN)],
      "ASSERTION: the overview's environment wins over the remembered one",
    ).toEqual([PROJECT.id, false]);
  });

  it("an environment the list has not reached is unknown, never nobody", () => {
    openAccount("user-a");
    publishAccount(appAtomRegistry);

    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("mate");
    expect(appAtomRegistry.get(zeropsMatesAtom).get(FEN)?.serviceId).toBe(ZCP.id);
    // Another organization's Mate: its list has not been read.
    expect(whoLivesAt(appAtomRegistry, ELSEWHERE)).toBe("unknown");
    // A server that says it runs outside Zerops holds nobody without any list.
    expect(whoLivesAt(appAtomRegistry, OUTSIDE)).toBe("nobody");
  });

  it("a listed and connected container stays unknown until HQ names its Mate", () => {
    openAccount("user-a");
    publishAccount(appAtomRegistry, false);
    expect(appAtomRegistry.get(heldCandidateRowsAtom).length).toBeGreaterThan(0);
    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("unknown");
  });

  // Run 2 (2026-10-16): an added Mate, up and its sign-in waiting, landed on a bare conversation
  // titled with its raw project name: HQ named it, but its own word of its environment had not
  // reached HQ yet.
  it("a Mate HQ names knows its conversation by the server that says it lives in its project", () => {
    openAccount("user-a");
    const store = publishAccount(appAtomRegistry, false);
    seedHqNavigation(store, organization.organizationId, {
      structure: {
        apps: [],
        ungrouped: [{ projectId: PROJECT.id, name: PROJECT.name, mate: { face: "sky:seal" } }],
      },
    });
    expect(whoLivesAt(appAtomRegistry, FEN)).toBe("mate");
    // A server in a project HQ names no Mate in stays unknown.
    expect(whoLivesAt(appAtomRegistry, ELSEWHERE)).toBe("unknown");
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
