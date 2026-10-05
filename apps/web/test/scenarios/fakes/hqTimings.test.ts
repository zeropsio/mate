// @effect-diagnostics nodeBuiltinImport:off -- real Core timers and real loopback websocket receipts.
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { WebSocket } from "ws";
import { tempPostgresLayer } from "../../../../hq/test/harness/tempPostgres.ts";
import {
  seedCoreWorld,
  sessionFor,
  ticketFor,
  untilHealth,
} from "../../../../hq/test/harness/runningCore.ts";
import { startScenarioCore, type HqTimings } from "../harness/hqCore.ts";
import { serve, deadline } from "../harness/http.ts";
import { ZeropsFake } from "./zerops.ts";

it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
  const cases: [string, HqTimings, number[]][] = [
    ["production defaults", {}, [20_000, 60_000, 30_000]],
    [
      "per-scenario overrides",
      { pingEvery: 40_000, reconcileEvery: 90_000, streamRecheck: 50_000 },
      [40_000, 90_000, 50_000],
    ],
  ];
  for (const [name, timings, expected] of cases) {
    it.effect(
      `real Core schedules ${name} instead of rapid pings and role/structure rechecks`,
      () =>
        Effect.gen(function* () {
          const native = yield* Clock.Clock;
          const scheduled: number[] = [];
          let changed = () => {};
          const observed = new Proxy(native, {
            get(target, key) {
              if (key === "sleep")
                return (duration: Duration.Duration) =>
                  Effect.suspend(() => {
                    scheduled.push(Duration.toMillis(duration));
                    changed();
                    return target.sleep(duration);
                  });
              return Reflect.get(target, key);
            },
          });
          yield* Effect.gen(function* () {
            const fake = new ZeropsFake(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG"));
            const api = yield* Effect.acquireRelease(
              Effect.promise(() => serve(fake.handle, fake.socket)),
              (api) => Effect.promise(api.close),
            );
            const core = yield* startScenarioCore(
              { baseUrl: `${api.origin}/api/rest/public`, world: fake.world },
              timings,
            );
            yield* untilHealth(core.call, "active");
            const session = yield* sessionFor(core.call, "door-owner");
            const ticket = yield* ticketFor(core.call, session);
            const socket = yield* Effect.acquireRelease(
              Effect.sync(
                () =>
                  new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                  ),
              ),
              (socket) => Effect.sync(() => socket.terminate()),
            );
            yield* Effect.promise(() =>
              deadline(
                new Promise<void>((resolve, reject) => {
                  socket.once("message", () => resolve());
                  socket.once("error", reject);
                }),
                "Core structure first frame",
              ),
            );
            // The initial snapshot can precede starting the stream's recheck timer. Wait for its
            // scheduling receipt, never a wall-time delay or an assumption about snapshot ordering.
            yield* Effect.promise(() =>
              deadline(
                new Promise<void>((resolve) => {
                  changed = () => {
                    if (expected.every((ms) => scheduled.includes(ms))) resolve();
                  };
                  changed();
                }),
                "Core ping/reconcile/role-check timer scheduling",
                5000,
              ),
            );
            // Observe the clock boundary of running Core, not a copy of its configuration object.
            for (const milliseconds of expected) expect(scheduled).toContain(milliseconds);
            expect(scheduled).not.toContain(200);
            expect(socket.readyState).toBe(WebSocket.OPEN);
          }).pipe(Effect.provideService(Clock.Clock, observed));
        }),
    );
  }
});
