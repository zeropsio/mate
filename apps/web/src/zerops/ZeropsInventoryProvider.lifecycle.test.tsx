import { act, useEffect } from "react";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as Clock from "effect/Clock";
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
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { ZeropsDataContext } from "./zeropsDataContext";
import { inventoryProjectRefKey, useZeropsInventory, type Inventory } from "./inventoryContext";
import { ZeropsInventoryProvider } from "./ZeropsInventoryProvider";

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

  #text = "";

  set textContent(value: string) {
    this.childNodes = [];
    this.#text = value;
  }

  /**
   * What a person would read off this subtree — the shim's only rendering.
   * React writes a lone text child straight onto `textContent` rather than
   * appending a node, so an element with no children still carries its own.
   */
  get textContent(): string {
    if (this.nodeType === 3 || this.childNodes.length === 0) return this.#text;
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set nodeValue(value: string) {
    this.#text = value;
  }

  get nodeValue(): string {
    return this.#text;
  }

  appendChild(child: TestNode) {
    this.#text = "";
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: TestNode, before: TestNode | null) {
    if (before === null) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
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
  createTextNode(text: string) {
    const node = new TestNode("#text", this, 3);
    node.nodeValue = text;
    return node;
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

const mountInventory = Effect.fn(function* (
  ids: ReadonlyArray<string> = ["kept"],
  options: {
    readonly holdFirstRound?: boolean;
    /** Projects whose own read answers 503 from the start. */
    readonly failing?: ReadonlyArray<string>;
    /** Memberships the first `fetchUser` answers with. */
    readonly firstMemberships?: ReadonlyArray<never>;
  } = {},
) {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
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
  let firstMemberships = options.firstMemberships;
  let registrationGate: Deferred.Deferred<void> | null = null;
  const indexed = new Set(ids);
  const failing = new Set(options.failing);
  const client = {
    fetchUser: vi.fn(async () => {
      if (fetchGate !== null) await fetchGate;
      if (firstMemberships === undefined) return user;
      const first = { ...user, clientUserList: firstMemberships };
      firstMemberships = undefined;
      return first;
    }),
    listAccessibleClientProjects: vi.fn(async () =>
      [...projects.values()].filter(({ id }) => indexed.has(id)),
    ),
    fetchProject: vi.fn(async (id: string) => {
      if (failing.has(id)) throw new ZeropsApiError("Unavailable", "server", 503);
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
  let grantsWhenChildMounted: number | null = null;
  function Consumer() {
    const value = useZeropsInventory();
    useEffect(() => {
      grantsWhenChildMounted ??= grants.length;
      inventory = value;
      inventoryPublications++;
    }, [value]);
    return null;
  }
  // A first round that does not settle until the test lets it — not one that
  // fails. `fetchUser` is simply left pending, which is the shape a dropped
  // connection leaves.
  const firstRound = signal();
  if (options.holdFirstRound === true) fetchGate = firstRound.promise;
  const { createRoot } = yield* Effect.promise(() => import("react-dom/client"));
  const container = document.createElement("div");
  const root = createRoot(container);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => act(async () => root.unmount()));
      yield* actual.shutdown("application-close");
      registry.dispose();
    }),
  );
  const tree = () => (
    <RegistryContext value={registry}>
      <ZeropsDataContext value={{ runtime, organizationRef: () => organization, projectRef }}>
        <ZeropsInventoryProvider>
          <Consumer />
        </ZeropsInventoryProvider>
      </ZeropsDataContext>
    </RegistryContext>
  );
  yield* Effect.promise(async () => act(async () => root.render(tree())));
  yield* Effect.promise(async () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    }),
  );
  if (options.holdFirstRound !== true)
    yield* Effect.promise(async () => act(async () => admitted.promise));
  return {
    container,
    runtime,
    client,
    user,
    projects,
    indexed,
    failing,
    grants,
    projectRef,
    inventory: () => inventory,
    unmount: () => Effect.promise(async () => act(async () => root.unmount())),
    /** The held first round's reads answer; resolves once a grant reached the runtime. */
    verifyFirstRound: () =>
      Effect.promise(async () =>
        act(async () => {
          firstRound.resolve();
          await admitted.promise;
        }),
      ),
    /** Re-renders with a new session callback, which tears the provider's effect down and runs it again. */
    rerun: () => {
      session.current = { ...(session.current as object), updateVerifiedMemberships: vi.fn() };
      return Effect.promise(async () => act(async () => root.render(tree())));
    },
    inventoryPublications: () => inventoryPublications,
    grantsWhenChildMounted: () => grantsWhenChildMounted,
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
    /** Moves both clocks, running every timer that comes due. */
    advance: (ms: number) =>
      Effect.promise(async () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        }),
      ),
    /**
     * Holds the next round's user read, and the push half's registrations,
     * until the test lets each go.
     */
    holdRenewal: () => {
      const gate = signal();
      fetchGate = gate.promise;
      registrationGate = Deferred.makeUnsafe<void>();
      admitted = signal();
      return {
        /** The round's REST reads answer. */
        release: () => gate.resolve(),
        /** The round's REST reads answer; resolves once its grant reached the runtime. */
        verify: () =>
          Effect.promise(async () =>
            act(async () => {
              gate.resolve();
              await admitted.promise;
            }),
          ),
        /** The held registrations answer; resolves once every interest observes again. */
        establish: () =>
          Effect.gen(function* () {
            const registration = registrationGate!;
            registrationGate = null;
            yield* actEffect(Deferred.succeed(registration, undefined));
            for (let turn = 0; turn < 200; turn++) {
              const { interests } = yield* actual.state;
              if ([...interests.values()].every(({ interest }) => interest?.status === "observing"))
                return;
              yield* Effect.promise(async () =>
                act(async () => {
                  await vi.advanceTimersByTimeAsync(0);
                }),
              );
            }
          }),
      };
    },
  };
});

/** When the renewal of a grant admitted at mount comes due (start + 15 min − the 3 min lead). */
const RENEWAL_DUE_MS = 12 * 60_000;

it.live("renews from REST alone while the push half still establishes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory();
      const renewal = harness.holdRenewal();
      yield* harness.advance(RENEWAL_DUE_MS);
      expect(harness.client.fetchUser).toHaveBeenCalledTimes(2);
      // A round no longer flips the inventory to loading.
      expect(harness.inventory()?.isLoading).toBe(false);
      yield* renewal.verify();
      // Granted while the renewal's re-registration is still held.
      expect(harness.grants).toHaveLength(2);
      yield* harness.advance(30_000);
      yield* renewal.establish();

      expect((yield* harness.runtime.state).access.status).toBe("verified");
      expect(harness.inventory()?.error).toBeNull();
      expect(harness.inventory()?.isLoading).toBe(false);
    }),
  ),
);

it.live("a renewal withholds a deleted project until a second read confirms it is gone", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory(["kept", "revoked"]);
      const renewal = harness.holdRenewal();
      harness.projects.delete("revoked");
      yield* harness.advance(RENEWAL_DUE_MS);
      yield* renewal.verify();
      const refs = () =>
        [...harness.inventory()!.projectRefs.values()].map(({ projectId }) => projectId);

      // One 403/404 closes the project's writes and withholds it; it stays listed (G6).
      expect(refs()).toEqual(["kept", "revoked"]);
      expect(
        harness
          .inventory()
          ?.authority.get(inventoryProjectRefKey(harness.projectRef("org", "revoked"))),
      ).toEqual({ kind: "withheld", reason: "access-denied", cause: null });
      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept"]);
      yield* renewal.establish();
      expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept", "revoked"]);
      expect(harness.inventory()?.isLoading).toBe(false);
      expect(harness.inventory()?.error).toBeNull();

      // The confirming read, 5 s after the denial, answers the same: it is gone.
      yield* harness.advance(5_000);
      expect(
        harness.client.fetchProject.mock.calls.filter(([id]) => id === "revoked"),
      ).toHaveLength(3);
      expect(refs()).toEqual(["kept"]);
      expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept"]);
      expect(harness.inventory()?.error).toBeNull();
    }),
  ),
);

const grantedProjects = (grant: VerifiedAccessGrant | undefined) =>
  grant?.projects.map(({ project }) => project.projectId);

it.live("a project whose evidence runs out leaves the runtime's grant at its own deadline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory(["kept", "flaky"]);
      const renewal = harness.holdRenewal();
      harness.failing.add("flaky");
      yield* harness.advance(RENEWAL_DUE_MS);
      yield* renewal.verify();
      // The renewal carries the project's evidence from the first round, still fresh.
      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept", "flaky"]);

      yield* harness.advance(15 * 60_000 - RENEWAL_DUE_MS);

      // Its writes and reads end with its own evidence, not with the next round (G2, T-L19).
      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept"]);
      const access = (yield* harness.runtime.state).access;
      expect(
        access.status === "verified" && access.projects.map(({ project }) => project.projectId),
      ).toEqual(["kept"]);
    }),
  ),
);

it.live(
  "a renewal that no longer reads an organization drops its projects from the runtime's grant",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* mountInventory();
        harness.projects.set("created", {
          id: "created",
          clientId: "org",
          name: "Created",
          status: "ACTIVE",
        });
        yield* actEffect(
          harness.runtime.observeAccess({
            kind: "project-access-established",
            accountEpoch: harness.grants.at(-1)!.accountEpoch,
            project: harness.projectRef("org", "created"),
          }),
        );
        // The account is removed from the organization before the renewal.
        harness.user.clientUserList = [];
        const renewal = harness.holdRenewal();
        yield* harness.advance(RENEWAL_DUE_MS);
        yield* renewal.verify();

        // Neither the project the evidence held nor the one a command established stays (G2).
        expect(grantedProjects(harness.grants.at(-1))).toEqual([]);
        const access = (yield* harness.runtime.state).access;
        expect(access.status === "verified" && access.projects).toEqual([]);
        expect(harness.inventory()?.projectRefs.size).toBe(0);
      }),
    ),
);

it.live("a project its own retry verifies joins the runtime's grant before the next round", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory(["kept", "flaky"], { failing: ["flaky"] });
      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept"]);
      harness.failing.delete("flaky");

      // The project's own retry comes 10 s after the round, long before the renewal.
      yield* harness.advance(10_000);

      expect(harness.client.fetchUser).toHaveBeenCalledTimes(1);
      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept", "flaky"]);
    }),
  ),
);

it.live("closes the api's writes at the evidence deadline on the api's own clock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory();
      // The system clock was set apart from the api's `timeOrigin + performance.now()`.
      expect(yield* Clock.currentTimeMillis).not.toBe(performance.timeOrigin + performance.now());
      expect(harness.client.setWritesAllowed).toHaveBeenLastCalledWith(
        true,
        performance.timeOrigin + performance.now() + 15 * 60_000,
      );
    }),
  ),
);

it.live("a round cut off by sign-out is recorded as dropped", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory();
      mateDiagnostics.enable();
      mateDiagnostics.clear();
      const renewal = harness.holdRenewal();
      yield* harness.advance(RENEWAL_DUE_MS);
      yield* harness.unmount();
      renewal.release();
      yield* harness.advance(0);

      const rounds = mateDiagnostics
        .snapshot()
        .filter((entry) => entry.kind === "access-round" && entry.phase !== "start");
      expect(rounds.map((entry) => "phase" in entry && entry.phase)).toEqual(["dropped"]);
    }),
  ),
);

it.live("a round of a torn-down effect run never reaches the next run's grant", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // Both runs start their own round 1; the torn-down run's reads no memberships.
      const harness = yield* mountInventory(["kept"], {
        holdFirstRound: true,
        firstMemberships: [],
      });
      yield* harness.rerun();
      expect(harness.client.fetchUser).toHaveBeenCalledTimes(2);
      yield* harness.verifyFirstRound();

      expect(grantedProjects(harness.grants.at(-1))).toEqual(["kept"]);
    }),
  ),
);

it.live("offers a way off the checking screen when the round never settles", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // A round that rejects puts its reason on screen with a retry. One that
      // simply never settles used to leave a spinner with no words — the
      // label is `sr-only` — and no exit, because the renewal timer is armed
      // only once a round has completed.
      const harness = yield* mountInventory(["kept"], { holdFirstRound: true });
      yield* Effect.promise(async () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        }),
      );
      expect(harness.container.textContent).not.toContain("Try again");
      yield* Effect.promise(async () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        }),
      );
      expect(harness.container.textContent).toContain("Still checking your Zerops projects.");
      expect(harness.container.textContent).toContain("Try again");
      expect(harness.container.textContent).toContain("Sign out");
    }),
  ),
);

it.live(
  "a renewal is not held open by a project the organization still lists and cannot hand over",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Deleting a project from outside the app — the Zerops GUI in another
        // tab, or a script — is not atomic: the organization's list carries it
        // for seconds after fetching it already answers `not-found`. That
        // answer is settled knowledge, not an unfinished read, and treating it
        // as one held the round open forever (measured live 2026-09-20).
        const harness = yield* mountInventory(["kept", "vanishing"]);
        harness.client.fetchProject.mockImplementation(async (id: string) => {
          const project = harness.projects.get(id);
          if (id === "vanishing" || project === undefined)
            throw new ZeropsApiError("Gone", "not-found");
          return project;
        });
        const renewal = harness.holdRenewal();
        yield* harness.advance(RENEWAL_DUE_MS);
        yield* renewal.verify();
        yield* renewal.establish();
        expect(harness.inventory()?.isLoading).toBe(false);
        // Withheld until the confirming read, then gone (G6).
        expect(
          harness
            .inventory()
            ?.authority.get(inventoryProjectRefKey(harness.projectRef("org", "vanishing"))),
        ).toEqual({ kind: "withheld", reason: "access-denied", cause: null });
        yield* harness.advance(5_000);
        expect(harness.inventory()?.isLoading).toBe(false);
        expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept"]);
      }),
    ),
);

it.live("a renewal reverifies a command-created project the search index still omits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* mountInventory();
      yield* harness.advance(RENEWAL_DUE_MS - 1_000);
      harness.projects.set("created", {
        id: "created",
        clientId: "org",
        name: "Created",
        status: "ACTIVE",
      });
      yield* actEffect(
        harness.runtime.observeAccess({
          kind: "project-access-established",
          accountEpoch: harness.grants.at(-1)!.accountEpoch,
          project: harness.projectRef("org", "created"),
        }),
      );
      const renewal = harness.holdRenewal();
      yield* harness.advance(1_000);
      yield* renewal.verify();
      yield* renewal.establish();
      expect(harness.client.fetchProject).toHaveBeenCalledWith("created");
      expect(harness.grants.at(-1)?.projects.map(({ project }) => project.projectId)).toEqual([
        "kept",
        "created",
      ]);
      expect(harness.inventory()?.projects.map(({ id }) => id)).toEqual(["kept", "created"]);
    }),
  ),
);

it.live("has given the runtime its grant before the first child mounts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // A child's first act can be to lease a resource, and the broker refuses
      // one until this grant has landed — once, permanently, because the
      // lease is keyed and never retried. Opening the gate first made
      // `/zerops/new` fail its locations read on every cold load
      // (measured 2026-09-20).
      const harness = yield* mountInventory();
      expect(harness.grantsWhenChildMounted()).toBeGreaterThanOrEqual(1);
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
