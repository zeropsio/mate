import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as TestClock from "effect/testing/TestClock";
import * as Deferred from "effect/Deferred";
import { AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentId, WS_METHODS, ZeropsMateUpdateError } from "@t3tools/contracts";
import { PrimaryConnectionTarget } from "../../connection/model.ts";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../../rpc/protocol.ts";
import type * as RpcSession from "../../rpc/session.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateUpdate, mateUpdateStates } from "../projections/mateUpdate.ts";
import { makeMateUpdates, makeMateUpdateWire } from "./mateUpdate.ts";

const env = EnvironmentId.make("one");
const other = EnvironmentId.make("two");
const server = { serverVersion: "1", bootId: "old" };
const updated = { action: "updated" as const, restarted: true, serverVersion: "1", to: "2" };
const available = { installed: "1", latest: "2", available: true, checkedAt: "source" };
const setup = (overrides: Partial<Parameters<typeof makeMateUpdates>[0]> = {}) => {
  const store = makeAccountStore(AtomRegistry.make());
  let ids = 0;
  const host = makeMateUpdates({
    store,
    wire: { update: () => Effect.succeed(updated), check: () => Effect.succeed(available) },
    isCurrent: () => true,
    makeId: () => `request-${++ids}`,
    ...overrides,
  });
  return { store, host, read: (id = env) => mateUpdate.derive(readsOfState(store.state()), id) };
};

// witness: packages/client-runtime/src/data/adapters/mateUpdate.ts | value: { requestId, containerKey }, → value: { requestId, containerKey: null },
it("AD29: An update belongs to the Mate it was started on, also while that Mate's socket is down", async () => {
  const { host, store, read } = setup();
  await host.update(env, server, "2", "container");
  expect(read().state).toEqual({ phase: "updating", to: "2" });
  expect(read(other).state).toEqual({ phase: "idle" });
  expect(mateUpdateStates.derive(readsOfState(store.state()), null).get(env)?.containerKey).toBe(
    "container",
  );
  host.observe(env, null);
  expect(read().state.phase).toBe("updating");
  host.close();
});

// witness: packages/client-runtime/src/data/adapters/mateUpdate.ts | record.receipt === null || record.receipt.outcome.kind === "pending" → record.receipt?.outcome.kind === "pending"
it("AD30: An update whose answer was lost is never sent again, and the Mate's later evidence settles it", async () => {
  const sends: EnvironmentId[] = [];
  const { host, read } = setup({
    wire: {
      update: (id) =>
        Effect.suspend(() => {
          sends.push(id);
          return Effect.fail(
            new ZeropsMateUpdateError({ reason: "timed-out", message: "Timed out" }),
          );
        }),
      check: () => Effect.succeed(available),
    },
  });
  await host.update(env, server, "2", null);
  expect(read().state.phase).toBe("updating");
  expect(read().notice).toContain("answer was lost");
  await host.update(env, server, "2", null);
  expect(sends).toEqual([env]);
  host.observe(env, { serverVersion: "2", bootId: "new" });
  expect(read().state).toEqual({ phase: "updated", to: "2" });
  host.close();
});

// witness: packages/client-runtime/src/data/adapters/mateUpdate.ts | record.submission !== "uncertain" && → record.submission !== "recorded" &&
it.effect(
  "AD31: A version read before the Mate answers cannot turn a pending Update into a success",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<typeof updated>();
      const { host, read } = setup({
        wire: {
          update: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Deferred.await(answer);
            }),
          check: () => Effect.succeed(available),
        },
      });
      const update = host.update(env, server, "2", null);
      yield* Deferred.await(started);
      host.observe(env, { serverVersion: "2", bootId: "new" });
      const beforeAnswer = read().state.phase;
      yield* Deferred.succeed(answer, updated);
      yield* Effect.promise(() => update);
      host.observe(env, { serverVersion: "2", bootId: "new" });
      const completed = read().state;
      host.close();
      expect(beforeAnswer).toBe("updating");
      expect(completed).toEqual({ phase: "updated", to: "2" });
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateUpdate.ts | Effect.timeoutOption(waitMs) → Effect.timeout(waitMs)
it.effect(
  "AD32: An update its Mate never received says it was not sent, and Update sends it again",
  () =>
    Effect.gen(function* () {
      const sends: Array<string> = [];
      const client = {
        [WS_METHODS.zeropsMateUpdate]: () =>
          Effect.sync(() => {
            sends.push("update");
            return updated;
          }),
      } as unknown as WsRpcProtocolClient;
      const link = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(Option.none());
      const supervisor = EnvironmentSupervisor.of({
        target: new PrimaryConnectionTarget({
          environmentId: env,
          label: "Milo",
          httpBaseUrl: "https://milo.example.test",
          wsBaseUrl: "wss://milo.example.test",
        }),
        session: link,
      } as unknown as EnvironmentSupervisor["Service"]);
      const registry = {
        run: <A, E, R>(_: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
          Effect.provideService(effect, EnvironmentSupervisor, supervisor),
      } as unknown as EnvironmentRegistry["Service"];
      const up = Option.some({ client, closed: Effect.never } as unknown as RpcSession.RpcSession);
      const clock = yield* Clock.Clock;
      const wire = makeMateUpdateWire(registry, { connectWaitMs: 50 });
      const { host, read } = setup({
        wire: {
          ...wire,
          update: (id) => wire.update(id).pipe(Effect.provideService(Clock.Clock, clock)),
        },
      });
      const update = host.update(env, server, "2", null);
      yield* TestClock.adjust(50);
      yield* Effect.promise(() => update);
      expect(sends).toEqual([]);
      expect(read().state).toEqual({
        phase: "failed",
        message: "This Mate is not connected, so the update was not sent. Update again once it is.",
      });
      yield* SubscriptionRef.set(link, up);
      yield* Effect.promise(() => host.update(env, server, "2", null));
      expect(sends).toEqual(["update"]);
      expect(read().state).toEqual({ phase: "updating", to: "2" });
      host.close();
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateUpdate.ts | { restart }), → { restart: { ...restart, mate: restart.mate ?? server.serverVersion } }),
it("AD33: A finished restart for zcp says zcp's version, never the unchanged Mate's", async () => {
  const started = {
    action: "none" as const,
    restarted: false,
    started: true,
    bootId: "old",
    serverVersion: "1",
  };
  const behind = {
    installed: "1",
    latest: "1",
    available: false,
    checkedAt: "now",
    zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
    restart: { needed: true },
  };
  const { host, read } = setup({
    wire: { update: () => Effect.succeed(started), check: () => Effect.succeed(behind) },
  });
  await host.update(env, server, "zcp 9.226.0", null, { zcp: "9.226.0" });
  host.observe(env, {
    serverVersion: "1",
    bootId: "new",
    update: {
      ...behind,
      zcp: { installed: "9.226.0", latest: "9.226.0", behind: false },
      restart: { needed: false },
    },
  });
  expect(read().state).toEqual({ phase: "updated", to: null, zcp: "9.226.0" });
  host.close();
});
