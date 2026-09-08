import { act, useEffect } from "react";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";
import { expect, it } from "@effect/vitest";
import {
  ZeropsApiError,
  zeropsClientsFromUser,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import {
  makeZeropsDataRuntime,
  decodeEntityDirectResponse,
  decodeRegistrationResponse,
  decodeNativeFrame,
  type RegistrationRequest,
  type ReceiverEvent,
  AccountEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type ProjectRef,
  type VerifiedAccessGrant,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsInventory, type Inventory } from "./inventoryContext";
import { ZeropsInventoryProvider } from "./ZeropsInventoryProvider";
import { refreshZeropsCandidates } from "./candidatesRefresh";

const session = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSession: () => session.current }));
vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: () => null,
}));

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  createTextNode(_text: string) {
    return new TestNode("#text", this, 3);
  }
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Keep React's act boundary open while the test's own Effect runtime does the work. */
function actEffect<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return Effect.suspend(() => {
    const done = signal();
    const completion = Promise.resolve(act(async () => done.promise));
    return work.pipe(
      Effect.ensuring(
        Effect.sync(done.resolve).pipe(Effect.andThen(Effect.promise(() => completion))),
      ),
    );
  });
}

const mountInventory = Effect.fn(function* (ids: ReadonlyArray<string> = ["kept"]) {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(1788825600000);
  installTestDom();
  const registry = AtomRegistry.make();
  const account = {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  };
  const organization = {
    kind: "organization" as const,
    account,
    organizationId: ZeropsOrganizationId.make("org"),
  };
  const projectRef = (_org: string, id: string): ProjectRef => ({
    kind: "project",
    organization,
    projectId: ZeropsProjectId.make(id),
  });
  const projects = new Map(
    ids.map((id): [string, ZeropsProject] => [
      id,
      { id, clientId: "org", name: id, status: "ACTIVE", created: "2026-09-01T00:00:00Z" },
    ]),
  );
  const user = {
    id: "account",
    email: "test@example.test",
    clientUserList: [
      { id: "membership", clientId: "org", roleCode: "OWNER", canCreateProjects: true },
    ],
  };
  let fetchGate: Promise<void> | null = null;
  let registrationGate: Deferred.Deferred<void> | null = null;
  const indexed = new Set(ids);
  const client = {
    fetchUser: vi.fn(async () => {
      if (fetchGate !== null) await fetchGate;
      return user;
    }),
    listAccessibleClientProjects: vi.fn(async () =>
      [...projects.values()].filter(({ id }) => indexed.has(id)),
    ),
    fetchProject: vi.fn(async (id: string) => {
      const project = projects.get(id);
      if (project === undefined) throw new ZeropsApiError("Gone", "not-found");
      return project;
    }),
    setWritesAllowed: vi.fn(),
  };
  session.current = {
    client,
    organizations: zeropsClientsFromUser(user),
    updateVerifiedMemberships: vi.fn(),
    signOut: vi.fn(),
  };
  const events = yield* Queue.unbounded<ReceiverEvent>();
  const registrations = new Map<RegistrationRequest["subscriptionName"], RegistrationRequest>();
  let delivered = yield* Deferred.make<void>();
  let nextId = 0;
  const actual = yield* makeZeropsDataRuntime({
    scope: { account, epoch: AccountEpoch.make(1) },
    atomRegistry: registry,
    makeOpaqueId: () => `mounted-${++nextId}`,
    adapter: {
      openReceiver: (_scope, organization, identity) =>
        Effect.succeed({
          identity,
          organization,
          delivery: "hot-single-consumer-buffered-before-open-resolves",
          events: Stream.fromQueue(events).pipe(
            Stream.tap((event) =>
              event.kind === "pong" ? Deferred.succeed(delivered, undefined) : Effect.void,
            ),
          ),
        }),
      register: (_handle, request) =>
        Effect.gen(function* () {
          if (registrationGate !== null) yield* Deferred.await(registrationGate);
          registrations.set(request.subscriptionName, request);
          if (request.descriptor.kind === "entity-updates") return { responseObservations: [] };
          const items =
            request.descriptor.query.kind === "projects-of-organization"
              ? [...projects.values()].filter(({ id }) => indexed.has(id))
              : [];
          return {
            responseObservations: decodeRegistrationResponse(request, {
              items,
              total: items.length,
            }).observations,
          };
        }),
      read: (ticket) => {
        if (ticket.target.kind !== "project") return Effect.succeed({ observations: [] });
        const value = projects.get(ticket.target.ref.projectId);
        if (value === undefined)
          return Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "not-found",
            message: "Gone",
            retryable: false,
            accountRevocationEvidence: false,
          });
        return Effect.succeed({
          observations: decodeEntityDirectResponse(ticket, value).observations,
        });
      },
      execute: () => Effect.succeed({ processRefs: [], observations: [] }),
      closeReceiver: () => Effect.void,
    },
  });
  const grants: VerifiedAccessGrant[] = [];
  let admitted = signal();
  const runtime: ManagedZeropsDataRuntime = {
    ...actual,
    observeAccess: (observation) =>
      actual.observeAccess(observation).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (observation.kind === "access-verified") {
              grants.push(observation.grant);
              admitted.resolve();
            }
          }),
        ),
      ),
  };
  let inventory: Inventory | null = null;
  let inventoryPublications = 0;
  function Consumer() {
    const value = useZeropsInventory();
    useEffect(() => {
      inventory = value;
      inventoryPublications++;
    }, [value]);
    return null;
  }
  const { createRoot } = yield* Effect.promise(() => import("react-dom/client"));
  const root = createRoot(document.createElement("div"));
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => act(async () => root.unmount()));
      yield* actual.shutdown("application-close");
      registry.dispose();
    }),
  );
  yield* Effect.promise(async () =>
    act(async () =>
      root.render(
        <RegistryContext value={registry}>
          <ZeropsDataContext value={{ runtime, organizationRef: () => organization, projectRef }}>
            <ZeropsInventoryProvider>
              <Consumer />
            </ZeropsInventoryProvider>
          </ZeropsDataContext>
        </RegistryContext>,
      ),
    ),
  );
  yield* Effect.promise(async () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    }),
  );
  yield* Effect.promise(async () => act(async () => admitted.promise));
  return {
    runtime,
    client,
    projects,
    indexed,
    grants,
    projectRef,
    inventory: () => inventory,
    inventoryPublications: () => inventoryPublications,
    pushProject: (id: string, name: string) =>
      actEffect(
        Effect.gen(function* () {
          const request = [...registrations.values()].find(
            (entry) =>
              entry.descriptor.kind === "entity-updates" && entry.descriptor.entity === "project",
          )!;
          const raw = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
            type: "search",
            subscriptionName: request.subscriptionName,
            data: { update: [{ ...projects.get(id)!, name }] },
          });
          const decoded = decodeNativeFrame(raw, registrations);
          if (decoded.kind !== "observations") throw new Error("Expected project observations");
          delivered = yield* Deferred.make<void>();
          for (const input of decoded.observations)
            yield* Queue.offer(events, { kind: "observation", input, bytes: raw.length });
          yield* Queue.offer(events, { kind: "pong" });
          yield* Deferred.await(delivered);
          yield* actual.observeAccess({ kind: "access-verified", grant: grants.at(-1)! });
        }),
      ),
    pauseRefresh: () => {
      const gate = signal();
      fetchGate = gate.promise;
      registrationGate = Deferred.makeUnsafe<void>();
      admitted = signal();
      return {
        verify: () =>
          Effect.promise(async () =>
            act(async () => {
              gate.resolve();
              await gate.promise;
            }),
          ),
        establish: () =>
          Effect.suspend(() => {
            const registration = registrationGate!;
            registrationGate = null;
            return actEffect(
              Deferred.succeed(registration, undefined).pipe(
                Effect.andThen(Effect.promise(() => admitted.promise)),
              ),
            );
          }),
      };
    },
  };
});

it.live(
  "renews once while verification finishes before slow establishment and survives the old expiry",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* mountInventory();
        const refresh = harness.pauseRefresh();
        yield* Effect.promise(async () =>
          act(async () => {
            await vi.advanceTimersByTimeAsync(14 * 60_000);
          }),
        );
        yield* refresh.verify();
        yield* Effect.promise(async () =>
          act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
          }),
        );
        expect(harness.client.fetchUser).toHaveBeenCalledTimes(2);
        expect(harness.grants).toHaveLength(1);
        yield* refresh.establish();
        expect(harness.grants).toHaveLength(2);
        yield* Effect.promise(async () =>
          act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
          }),
        );
        expect((yield* harness.runtime.state).access.status).toBe("verified");
        expect(harness.inventory()?.error).toBeNull();
      }),
    ),
);

it.live(
  "removes a deleted project from renewed demand without blocking the remaining project",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* mountInventory(["kept", "revoked"]);
        const refresh = harness.pauseRefresh();
        harness.projects.delete("revoked");
        yield* Effect.promise(async () => act(async () => refreshZeropsCandidates()));
        yield* refresh.verify();
        expect(
          [...harness.inventory()!.projectRefs.values()].map(({ projectId }) => projectId),
        ).toEqual(["kept"]);
        yield* refresh.establish();
        expect(harness.grants.at(-1)?.projects.map(({ project }) => project.projectId)).toEqual([
          "kept",
        ]);
        expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept"]);
        expect(harness.inventory()?.error).toBeNull();
      }),
    ),
);

it.live("reverifies command-created projects even while the search index still omits them", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory();
      harness.projects.set("created", {
        id: "created",
        clientId: "org",
        name: "Created",
        status: "ACTIVE",
      });
      const grant = harness.grants.at(-1)!;
      yield* actEffect(
        harness.runtime.observeAccess({
          kind: "access-verified",
          grant: {
            ...grant,
            projects: [
              ...grant.projects,
              {
                project: harness.projectRef("org", "created"),
                role: "OWNER",
                mutationsAllowed: true,
              },
            ],
          },
        }),
      );
      const refresh = harness.pauseRefresh();
      yield* Effect.promise(async () => act(async () => refreshZeropsCandidates()));
      yield* refresh.verify();
      yield* refresh.establish();
      expect(harness.client.fetchProject).toHaveBeenCalledWith("created");
      expect(harness.grants.at(-1)?.projects.map(({ project }) => project.projectId)).toEqual([
        "kept",
        "created",
      ]);
      expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept", "created"]);
    }),
  ),
);

it.live(
  "does not republish identical inventory DTOs from native updates but publishes actual edits",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* mountInventory();
        const before = harness.inventoryPublications();
        const receipt = (yield* harness.runtime.state).lastReceiptOrdinal;
        yield* harness.pushProject("kept", "kept");
        expect((yield* harness.runtime.state).lastReceiptOrdinal).toBeGreaterThan(receipt!);
        expect(harness.inventoryPublications()).toBe(before);
        yield* harness.pushProject("kept", "Renamed");
        expect(harness.inventory()?.projects[0]?.name).toBe("Renamed");
        expect(harness.inventoryPublications()).toBeGreaterThan(before);
        const demands = [...(yield* harness.runtime.state).interests.values()];
        expect(demands.map(({ descriptor }) => descriptor.kind)).toEqual([
          "organization-inventory",
          "project-inventory",
        ]);
      }),
    ),
);
