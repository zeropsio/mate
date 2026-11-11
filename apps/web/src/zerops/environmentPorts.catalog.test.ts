import { it, expect } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  type ConnectionCatalogEntry,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  makeAccountStore,
  makeMateAdapter,
  NO_RESTARTS,
  readRestartRecovery,
  type MateAdapter,
} from "@t3tools/client-runtime/data";
import { selectReachability, type LinkPhase } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { webEnvironmentPorts } from "./environmentPorts";
import { mateNoticeVoice } from "./mateNoticeVoice";
import { makeMateRecoveryHarness } from "@t3tools/client-runtime/rpc/testing";

// Only the catalog's source publications are controlled here. The web subscription, LINK
// consumer, reachability projection and notice voice all run their production implementations.
const source = vi.hoisted(() => ({
  entries: (
    _registry: AtomRegistry.AtomRegistry,
    _entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
  ) => {},
  state: (
    _registry: AtomRegistry.AtomRegistry,
    _id: EnvironmentId,
    _state: SupervisorConnectionState,
  ) => {},
}));
vi.mock("~/connection/catalog", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const { AVAILABLE_CONNECTION_STATE } = await import("@t3tools/client-runtime/connection");
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map<EnvironmentId, ConnectionCatalogEntry>() as ReadonlyMap<
      EnvironmentId,
      ConnectionCatalogEntry
    >,
  });
  const stateAtom = Atom.family((_id: EnvironmentId) =>
    Atom.make(AsyncResult.success(AVAILABLE_CONNECTION_STATE)),
  );
  source.entries = (registry, entries) =>
    registry.set(catalogValueAtom, { isReady: true, entries });
  source.state = (registry, id, state) => registry.set(stateAtom(id), AsyncResult.success(state));
  return { environmentCatalog: { catalogValueAtom, stateAtom } };
});
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    serverEnvironment: { configValueAtom: Atom.family((_id: EnvironmentId) => Atom.make(null)) },
  };
});

const KEY = "project-1:zcp";

function awaitMachine(adapter: MateAdapter, predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const stop = adapter.subscribe(() => {
      if (!predicate()) return;
      stop();
      resolve();
    });
    if (predicate()) {
      stop();
      resolve();
    }
  });
}

const makeConsumer = (environmentId: EnvironmentId) =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const descriptor = {
      environmentId,
      serverVersion: "0.12.0",
      update: null,
      identity: "ok" as const,
      identityCheckedAt: null,
    };
    const adapter = makeMateAdapter<null>({
      store,
      clock: {
        now: () => ({ wall: 0, mono: 0 }),
        random: () => 0.5,
        setTimer: () => () => {},
      },
      exchange: async () => ({ ok: true, environmentId, descriptor, credential: null }),
      install: async () => ({ ok: true }),
      readDescriptor: async () => descriptor,
      retryLink: () => {},
      retire: () => {},
      probe: async () => ({
        reading: { kind: "ready", descriptor, projectId: "project-1", initAt: null },
        sentAt: { wall: 0, mono: 0 },
      }),
      readInitAt: async () => null,
      readMateFlag: async () => "unknown",
      intents: { read: () => null, write: () => {} },
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        adapter.dispose();
        store.close();
        registry.dispose();
      }),
    );
    adapter.setAccount({ verified: true, zeropsState: "live" });
    adapter.setVisible(true);
    adapter.setTargets([
      {
        key: KEY,
        orgId: "org-1",
        presence: { kind: "present", origin: "https://mate.example.test" },
        origin: "https://mate.example.test",
        platform: { project: "ACTIVE", service: "ACTIVE" },
        record: environmentId,
      },
    ]);
    adapter.setDemand("recent", [KEY]);
    yield* Effect.promise(() =>
      awaitMachine(adapter, () => adapter.machines(KEY)?.environment.credential.kind === "held"),
    );
    const links: LinkPhase[] = [];
    const catalogs: number[] = [];
    const stop = webEnvironmentPorts(registry).catalog.listen({
      environments: (entries) => catalogs.push(entries.length),
      link: (id, phase) => {
        links.push(phase);
        adapter.link(id, phase);
      },
      updateUnderway: (id, from) => adapter.updateUnderway(id, from),
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const reachability = () => {
      const machine = adapter.machines(KEY)?.environment;
      if (machine === undefined)
        throw new Error("The listed Mate must have its environment machine.");
      return selectReachability(machine, environmentId);
    };
    const voice = (extra: Partial<Parameters<typeof mateNoticeVoice>[0]> = {}) =>
      mateNoticeVoice({
        reachability: reachability(),
        mateName: "Ada",
        conversationShown: true,
        nowMs: 0,
        ...extra,
      });
    return { registry, adapter, links, catalogs, reachability, voice };
  });

const recover = Effect.gen(function* () {
  const harness = yield* makeMateRecoveryHarness();
  const consumer = yield* makeConsumer(harness.target.environmentId);
  expect(consumer.catalogs).toEqual([0]);
  expect(consumer.links).toEqual([]);
  yield* harness.supervisor.connect;
  const failed = Option.getOrThrow(yield* harness.atState((state) => state.phase === "backoff"));
  source.state(consumer.registry, harness.target.environmentId, failed);
  // The Mate enters the catalog after the surface first painted, already carrying its refusal.
  source.entries(
    consumer.registry,
    new Map([
      [
        harness.target.environmentId,
        {
          target: harness.target,
          profile: Option.none(),
        },
      ],
    ]),
  );
  yield* Effect.promise(consumer.adapter.settled);
  expect(consumer.catalogs).toEqual([0, 1]);
  expect(consumer.links).toEqual([
    {
      phase: "backoff",
      retryAtMs: failed.retryAt,
      unavailableReason: "Mate has no connection to HQ (no-link).",
      noLink: true,
    },
  ]);
  expect(consumer.voice()).toMatchObject({
    surface: "banner",
    headline: "Ada is not connected to HQ.",
    actions: ["try-now"],
  });

  const process = {
    id: "independent-restart",
    actionName: "stack.restart",
    status: "RUNNING",
    created: "2026-10-07",
    projectId: "project-1",
    serviceStackIds: ["zcp"],
  };
  const recovery = {
    standing: { kind: "unknown" as const },
    status: "ACTIVE",
    process,
    lifecycle: readRestartRecovery({ ...NO_RESTARTS, running: [process.id] }, process, "ACTIVE"),
  };
  const limit = { provider: "Claude", detail: "The recorded provider limit still applies." };
  const restartBefore = consumer.voice({ recovery });
  const limitBefore = consumer.voice({ limit });

  yield* SubscriptionRef.changes(harness.supervisor.state).pipe(
    Stream.runForEach((state) =>
      Effect.promise(async () => {
        source.state(consumer.registry, harness.target.environmentId, state);
        await consumer.adapter.settled();
      }),
    ),
    Effect.forkScoped,
  );
  yield* harness.visibility(false);
  yield* TestClock.adjust("1 minute");
  expect(harness.attempts()).toBe(1);
  expect(consumer.voice()).toMatchObject({ headline: "Ada is not connected to HQ." });

  yield* harness.visibility(true);
  const socket = yield* harness.socket;
  expect(harness.attempts()).toBe(2);
  yield* Effect.promise(consumer.adapter.settled);
  expect(consumer.voice()).toMatchObject({ headline: "Ada is not connected to HQ." });
  socket.open();
  yield* harness.atState((state) => state.stage === "synchronizing");
  yield* Effect.promise(consumer.adapter.settled);
  expect(socket.sent[0]).toBe('{"ticket":"ticket-2"}');
  expect(consumer.voice()).toMatchObject({ headline: "Ada is not connected to HQ." });
  expect(consumer.voice({ conversationShown: false })).toMatchObject({
    surface: "stage",
    headline: "Ada is not connected to HQ.",
  });
  yield* harness.initialConfig(socket);
  yield* harness.atState((state) => state.phase === "connected");
  yield* Effect.promise(() =>
    awaitMachine(consumer.adapter, () => consumer.reachability().kind === "ready"),
  );
  expect(consumer.reachability()).toEqual({ kind: "ready", notice: null });
  return { ...consumer, recovery, limit, restartBefore, limitBefore };
});

it.effect(
  "A ticket acknowledgement alone does not clear the Mate's failed-connection notice.",
  () =>
    Effect.gen(function* () {
      const consumer = yield* recover;
      expect(consumer.voice()).toEqual({ surface: "none" });
      expect(consumer.voice({ conversationShown: false })).toEqual({ surface: "none" });
    }).pipe(Effect.provide(TestClock.layer())),
);

it.effect(
  "A recovered connection does not erase an independently evidenced restart or provider-limit notice.",
  () =>
    Effect.gen(function* () {
      const consumer = yield* recover;
      expect(consumer.restartBefore).toMatchObject({
        surface: "banner",
        headline: "Ada is restarting.",
        restarting: true,
      });
      expect(consumer.voice({ recovery: consumer.recovery })).toEqual(consumer.restartBefore);
      expect(consumer.limitBefore).toMatchObject({
        surface: "banner",
        secondary: "The recorded provider limit still applies.",
        severity: "attention",
      });
      expect(consumer.voice({ limit: consumer.limit })).toEqual(consumer.limitBefore);
    }).pipe(Effect.provide(TestClock.layer())),
);
