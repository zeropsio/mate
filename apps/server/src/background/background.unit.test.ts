import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  RpcClientId,
  type ClientActivityReportInput,
  type HostPowerSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerSettingsService } from "../serverSettings.ts";
import * as BackgroundPolicy from "./BackgroundPolicy.ts";
import * as HostPowerMonitor from "./HostPowerMonitor.ts";

const TEST_NOW = DateTime.makeUnsafe("2026-05-13T00:00:00.000Z");

// What a container reports: no desktop telemetry, so every value is unknown and stale.
const nominalHostPower: HostPowerSnapshot = {
  source: "unknown",
  idle: "unknown",
  idleSeconds: null,
  locked: "unknown",
  suspended: false,
  onBattery: "unknown",
  lowPowerMode: "unknown",
  thermalState: "unknown",
  stale: true,
  updatedAt: TEST_NOW,
};

const vcs = { type: "vcs-status", cwd: "/repo" } as const;

function makeReport(overrides: Partial<ClientActivityReportInput> = {}): ClientActivityReportInput {
  return {
    clientId: "client-1",
    clientKind: "web",
    visible: true,
    focused: true,
    idleMs: 0,
    scopes: [vcs],
    observedAt: TEST_NOW,
    ...overrides,
  };
}

function makeLayer(
  hostPower: HostPowerSnapshot,
  settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {},
) {
  const hostLayer = Layer.effect(
    HostPowerMonitor.HostPowerMonitor,
    Effect.gen(function* () {
      const changes = yield* PubSub.sliding<HostPowerSnapshot>(1);
      let snapshot = hostPower;
      return HostPowerMonitor.HostPowerMonitor.of({
        snapshot: Effect.sync(() => snapshot),
        report: (next) =>
          Effect.sync(() => {
            snapshot = next;
          }).pipe(Effect.andThen(PubSub.publish(changes, next)), Effect.asVoid),
        streamChanges: Stream.fromPubSub(changes),
      });
    }),
  );
  return BackgroundPolicy.layer.pipe(
    Layer.provide(Layer.merge(hostLayer, ServerSettingsService.layerTest(settingsOverrides))),
  );
}

// witness: apps/server/src/background/BackgroundPolicy.ts | if (lease.sessionId === sessionId && lease.rpcClientId === rpcClientId) { → if (lease.rpcClientId === rpcClientId) {
it.effect(
  "BG1: A client's scope lease lasts exactly as long as its Mate socket: a quiet open socket keeps it, closing the socket ends it, and another session's lease under the same client number stays",
  () =>
    Effect.gen(function* () {
      const quiet = yield* Effect.gen(function* () {
        const policy = yield* BackgroundPolicy.BackgroundPolicy;
        const sessionId = AuthSessionId.make("session-1");
        const rpcClientId = RpcClientId.make(1);
        yield* policy.reportClientActivity(sessionId, rpcClientId, makeReport());

        // No report follows: an open socket keeps its lease however long it stays quiet.
        yield* TestClock.adjust("1 hour");
        const open = yield* policy.snapshot;
        const runsWhileOpen = yield* policy.shouldRunScopeWork(vcs);

        yield* policy.removeRpcClient(sessionId, rpcClientId);
        const closed = yield* policy.snapshot;
        const runsAfterClose = yield* policy.shouldRunScopeWork(vcs);
        return { open, runsWhileOpen, closed, runsAfterClose };
      }).pipe(Effect.provide(makeLayer(nominalHostPower)));
      assert.equal(quiet.open.leases.length, 1);
      assert.equal(quiet.runsWhileOpen, true);
      assert.deepStrictEqual(quiet.closed.leases, []);
      assert.deepStrictEqual(quiet.closed.activeScopeKeys, []);
      assert.equal(quiet.runsAfterClose, false);

      const reused = yield* Effect.gen(function* () {
        const policy = yield* BackgroundPolicy.BackgroundPolicy;
        const rpcClientId = RpcClientId.make(1);
        yield* policy.reportClientActivity(
          AuthSessionId.make("session-1"),
          rpcClientId,
          makeReport({ clientId: "client-1" }),
        );
        yield* policy.reportClientActivity(
          AuthSessionId.make("session-2"),
          rpcClientId,
          makeReport({ clientId: "client-2" }),
        );
        yield* policy.removeRpcClient(AuthSessionId.make("session-1"), rpcClientId);
        return yield* policy.snapshot;
      }).pipe(Effect.provide(makeLayer(nominalHostPower)));
      assert.equal(reused.activeForegroundLeaseCount, 1);
      assert.equal(reused.leases[0]?.sessionId, AuthSessionId.make("session-2"));
      assert.equal(reused.leases[0]?.clientId, "client-2");
    }),
);

// witness: apps/server/src/background/BackgroundPolicy.ts | DateTime.toEpochMillis(now) - DateTime.toEpochMillis(lease.lastInteractionAt) <= → DateTime.toEpochMillis(now) - DateTime.toEpochMillis(lease.lastInteractionAt) <
it.effect(
  "BG2: A visible client counts as in use while focused and for 45 seconds after its last interaction on the server's clock, and losing focus does not renew it",
  () =>
    Effect.gen(function* () {
      const policy = yield* BackgroundPolicy.BackgroundPolicy;
      const sessionId = AuthSessionId.make("session-1");
      const rpcClientId = RpcClientId.make(1);
      yield* policy.reportClientActivity(sessionId, rpcClientId, makeReport({ idleMs: 0 }));

      // The window loses focus 30 s later with no interaction since: the blur does not renew it.
      yield* TestClock.adjust("30 seconds");
      yield* policy.reportClientActivity(
        sessionId,
        rpcClientId,
        makeReport({ focused: false, idleMs: 30_000 }),
      );
      assert.equal(yield* policy.shouldRunScopeWork(vcs), true);

      // The server's own clock ends it 45 s after the interaction, with no report in between.
      yield* TestClock.adjust("15 seconds");
      assert.equal(yield* policy.shouldRunScopeWork(vcs), true);
      yield* TestClock.adjust("1 millis");
      assert.equal(yield* policy.shouldRunScopeWork(vcs), false);
      assert.equal((yield* policy.snapshot).activeForegroundLeaseCount, 0);

      // A new interaction is the next report; the server stamps it on its own clock.
      yield* policy.reportClientActivity(
        sessionId,
        rpcClientId,
        makeReport({ focused: false, idleMs: 0 }),
      );
      assert.equal(yield* policy.shouldRunScopeWork(vcs), true);
    }).pipe(Effect.provide(makeLayer(nominalHostPower))),
);

// witness: apps/server/src/background/BackgroundPolicy.ts | return lease.visible && (lease.focused || wasRecentlyInteracted(lease, now)); → return lease.focused || wasRecentlyInteracted(lease, now);
it.effect(
  "BG3: A hidden client keeps its scope's demand visible but runs no scoped work, unless the performance profile allows background work",
  () =>
    Effect.gen(function* () {
      const hidden = makeReport({ focused: false, visible: false });

      const balanced = yield* Effect.gen(function* () {
        const policy = yield* BackgroundPolicy.BackgroundPolicy;
        yield* policy.reportClientActivity(
          AuthSessionId.make("session-1"),
          RpcClientId.make(1),
          hidden,
        );
        return {
          snapshot: yield* policy.snapshot,
          hasDemand: yield* policy.hasDemand(vcs),
          runs: yield* policy.shouldRunScopeWork(vcs),
        };
      }).pipe(Effect.provide(makeLayer(nominalHostPower)));
      assert.equal(balanced.snapshot.activeForegroundLeaseCount, 0);
      assert.deepStrictEqual(balanced.snapshot.activeScopeKeys, ["vcs-status:/repo"]);
      assert.equal(balanced.hasDemand, true);
      assert.equal(balanced.runs, false);

      const performance = yield* Effect.gen(function* () {
        const policy = yield* BackgroundPolicy.BackgroundPolicy;
        yield* policy.reportClientActivity(
          AuthSessionId.make("session-1"),
          RpcClientId.make(1),
          hidden,
        );
        return yield* policy.shouldRunScopeWork(vcs);
      }).pipe(
        Effect.provide(makeLayer(nominalHostPower, { backgroundActivityProfile: "performance" })),
      );
      assert.equal(performance, true);
    }),
);

// witness: apps/server/src/background/BackgroundPolicy.ts | connectionLeaseCount >= MAX_CLIENT_ACTIVITY_LEASES_PER_RPC_CLIENT && → connectionLeaseCount > MAX_CLIENT_ACTIVITY_LEASES_PER_RPC_CLIENT &&
it.effect(
  "BG4: One Mate socket holds at most 16 client leases, a new client beyond them replacing the oldest",
  () =>
    Effect.gen(function* () {
      const policy = yield* BackgroundPolicy.BackgroundPolicy;
      const sessionId = AuthSessionId.make("session-1");
      const rpcClientId = RpcClientId.make(1);
      for (let index = 0; index <= 16; index += 1) {
        yield* policy.reportClientActivity(
          sessionId,
          rpcClientId,
          makeReport({ clientId: `client-${index}` }),
        );
        // Each lease is stamped a millisecond later, so the oldest is defined.
        yield* TestClock.adjust("1 millis");
      }

      const clientIds = (yield* policy.snapshot).leases.map((lease) => lease.clientId);
      assert.equal(clientIds.length, 16);
      assert.isTrue(clientIds.includes("client-16"));
      assert.isFalse(clientIds.includes("client-0"));
    }).pipe(Effect.provide(makeLayer(nominalHostPower))),
);

// witness: apps/server/src/background/BackgroundPolicy.ts | if (hostPower.stale) return false; → if (!hostPower.stale) return false;
it.effect(
  "BG5: Host power values marked stale gate no scoped work, however constrained they read",
  () =>
    Effect.gen(function* () {
      const policy = yield* BackgroundPolicy.BackgroundPolicy;
      yield* policy.reportClientActivity(
        AuthSessionId.make("session-1"),
        RpcClientId.make(1),
        makeReport(),
      );

      assert.equal(yield* policy.shouldRunScopeWork(vcs), true);
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            ...nominalHostPower,
            locked: "true",
            onBattery: "true",
            lowPowerMode: "true",
            thermalState: "critical",
            stale: true,
          },
          { backgroundActivityProfile: "battery-saver" },
        ),
      ),
    ),
);
