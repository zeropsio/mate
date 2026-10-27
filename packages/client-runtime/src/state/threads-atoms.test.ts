import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { ConnectionWakeups, type ConnectionWakeup } from "../connection/wakeups.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { makeTestEngineHost } from "../data/__fixtures__/engineHost.ts";
import { engineRun, noteItem, personItem } from "../data/__fixtures__/mateEngine.ts";
import { mateEngineHostAtom } from "../data/engineHost.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createEnvironmentThreadDetailAtoms } from "./threadDetail.ts";
import { createEnvironmentThreadStateAtoms, type EnvironmentThreadState } from "./threads.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-1");
const THREAD: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Cached thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "ModelA" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  session: null,
};
const SNAPSHOT: OrchestrationThreadDetailSnapshot = { snapshotSequence: 7, thread: THREAD };

const CONNECTED_STATE: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};

const makeHarness = Effect.fn("TestThreadAtoms.makeHarness")(function* (options?: {
  readonly snapshot?: OrchestrationThreadDetailSnapshot;
  readonly connected?: boolean;
  readonly httpNone?: boolean;
  readonly initialLoad?: Effect.Effect<Option.Option<OrchestrationThreadDetailSnapshot>>;
  /** The door has not answered yet: no prepared connection. */
  readonly unprepared?: boolean;
  /** The engine protocol the door names, where it names one. */
  readonly mateEngine?: number;
  /** The thread the device cached. */
  readonly cachedThread?: OrchestrationThreadDetailSnapshot;
  /** The engine protocol the configuration the device last cached named. */
  readonly cachedMateEngine?: number;
}) {
  const clock = yield* Clock.Clock;
  const wakeups = yield* Queue.unbounded<ConnectionWakeup>();
  const client = {} as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.succeed({} as never),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const connectionState = yield* SubscriptionRef.make(
    options?.connected ? CONNECTED_STATE : AVAILABLE_CONNECTION_STATE,
  );
  const sessionRef = yield* SubscriptionRef.make(Option.some(session));
  const supervisor = EnvironmentSupervisor.of({
    target: TARGET,
    state: connectionState,
    session: sessionRef,
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
      options?.unprepared
        ? Option.none()
        : Option.some({
            environmentId: TARGET.environmentId,
            label: TARGET.label,
            httpBaseUrl: TARGET.httpBaseUrl,
            socketUrl: TARGET.wsBaseUrl,
            httpAuthorization: null,
            target: TARGET,
            ...(options?.mateEngine === undefined ? {} : { mateEngine: options.mateEngine }),
          }),
    ),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
    credentialRotated: Effect.void,
    reportStreamDefect: () => Effect.void,
  });
  const environmentRegistry = EnvironmentRegistry.of({
    entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
      new Map(),
    ),
    networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
    start: Effect.void,
    register: () => Effect.die("Unexpected environment registration"),
    registerPlatform: () => Effect.die("Unexpected environment registration"),
    reconcilePlatform: () => Effect.die("Unexpected environment reconciliation"),
    remove: () => Effect.die("Unexpected environment removal"),
    removeRelayEnvironments: () => Effect.die("Unexpected environment removal"),
    retryNow: () => Effect.void,
    park: () => Effect.void,
    unpark: () => Effect.void,
    rotateCredential: () => Effect.die("Unexpected credential rotation"),
    state: () => SubscriptionRef.get(supervisor.state),
    stateChanges: () => SubscriptionRef.changes(supervisor.state),
    run: (_environmentId, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisor),
    runStream: (_environmentId, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    followStream: (_environmentId, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  });
  const runtime = Atom.runtime(
    Layer.mergeAll(
      Layer.succeed(Clock.Clock, clock),
      Layer.succeed(ConnectionWakeups, { changes: Stream.fromQueue(wakeups) }),
      Layer.succeed(EnvironmentRegistry, environmentRegistry),
      Layer.succeed(
        EnvironmentCacheStore,
        EnvironmentCacheStore.of({
          loadShell: () => Effect.succeedNone,
          saveShell: () => Effect.void,
          loadThread: () => Effect.succeed(Option.fromNullishOr(options?.cachedThread)),
          saveThread: () => Effect.void,
          removeThread: () => Effect.void,
          loadServerConfig: () =>
            Effect.succeed(
              options?.cachedMateEngine === undefined
                ? Option.none()
                : Option.some({
                    environment: {
                      capabilities: { mateEngine: { protocol: options.cachedMateEngine } },
                    },
                  } as never),
            ),
          saveServerConfig: () => Effect.void,
          loadVcsRefs: () => Effect.succeedNone,
          saveVcsRefs: () => Effect.void,
          removeVcsRefs: () => Effect.void,
          clearVcsRefs: () => Effect.void,
          clear: () => Effect.void,
        }),
      ),
    ),
  );
  const raw = createEnvironmentThreadStateAtoms(runtime);
  const details = createEnvironmentThreadDetailAtoms(raw.stateAtom);
  const ref = { environmentId: TARGET.environmentId, threadId: THREAD_ID };
  const stateAtom = details.stateAtom(ref);
  const makeRegistry = Effect.acquireRelease(
    Effect.sync(() => AtomRegistry.make({ defaultIdleTTL: 60_000, timeoutResolution: 1 })),
    (registry) => Effect.sync(() => registry.dispose()),
  );
  const registry = yield* makeRegistry;

  return {
    runtime,
    supervisor,
    registry,
    makeRegistry,
    rawAtoms: raw,
    stateAtom,
    details,
    ref,
    connectionState,
    session,
    sessionRef,
    wakeups,
  };
});

function observeState(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) {
  return AtomRegistry.toStream(registry, atom).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}

describe("createEnvironmentThreadStateAtoms", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.effect.each([
    { name: "once its door names the engine", options: { mateEngine: 1 } },
    {
      name: "before its door answers, when the configuration it last cached named the engine",
      options: { unprepared: true, cachedMateEngine: 1, cachedThread: SNAPSHOT },
    },
  ])(
    "reads an engine Mate's conversation from its engine records, never its V1 history, $name",
    ({ options }) =>
      Effect.gen(function* () {
        const h = yield* makeHarness(options);
        const engine = makeTestEngineHost({
          environmentId: TARGET.environmentId,
          conversationId: THREAD_ID,
        });
        engine.deliver({
          runs: [engineRun(THREAD_ID, 1)],
          items: [
            personItem(`${THREAD_ID}/r/1`, 1, "Deploy the api"),
            noteItem(`${THREAD_ID}/r/1`, 2, "Deployed."),
          ],
        });
        h.registry.set(mateEngineHostAtom, engine.host);
        const unmount = h.registry.mount(h.stateAtom);
        const read = yield* observeState(h.registry, h.stateAtom, (state) =>
          Option.isSome(state.data),
        );
        expect(Option.getOrThrow(read.data).messages.map(({ text }) => text)).toEqual([
          "Deploy the api",
          "Deployed.",
        ]);
        expect(engine.counts.held).toBe(1);
        unmount();
      }),
  );

  it.effect("opens an engine Mate's conversation once the account that reads it is ready", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ mateEngine: 1 });
      const unmount = h.registry.mount(h.stateAtom);
      const opening = yield* observeState(
        h.registry,
        h.stateAtom,
        (state) => state.status === "synchronizing",
      );
      expect(opening.data).toEqual(Option.none());
      const engine = makeTestEngineHost({
        environmentId: TARGET.environmentId,
        conversationId: THREAD_ID,
      });
      engine.deliver({
        runs: [engineRun(THREAD_ID, 1)],
        items: [personItem(`${THREAD_ID}/r/1`, 1, "Deploy the api")],
      });
      h.registry.set(mateEngineHostAtom, engine.host);
      const read = yield* observeState(h.registry, h.stateAtom, (state) =>
        Option.isSome(state.data),
      );
      expect(Option.getOrThrow(read.data).messages.map(({ text }) => text)).toEqual([
        "Deploy the api",
      ]);
      unmount();
    }),
  );

  it.effect("shows a Mate whose engine speaks only a newer protocol as an update", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ mateEngine: 99 });
      const unmount = h.registry.mount(h.stateAtom);
      const update = yield* observeState(h.registry, h.stateAtom, (state) =>
        Option.isSome(state.error),
      );
      expect(Option.getOrThrow(update.error)).toMatch(/Update the app/);
      expect(update.data).toEqual(Option.none());
      unmount();
    }),
  );

  it.effect("shows a Mate from before the engine as the Mate's update", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const unmount = h.registry.mount(h.stateAtom);
      const update = yield* observeState(h.registry, h.stateAtom, (state) =>
        Option.isSome(state.error),
      );
      expect(Option.getOrThrow(update.error)).toMatch(/Update the Mate/);
      expect(update.data).toEqual(Option.none());
      unmount();
    }),
  );
});
