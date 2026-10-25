// @effect-diagnostics nodeBuiltinImport:off -- real Core timers and real loopback websocket receipts.
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { WebSocket } from "ws";
import { TempPostgres, tempPostgresLayer } from "../../../../hq/test/harness/tempPostgres.ts";
import {
  seedCoreWorld,
  sessionFor,
  ticketFor,
  untilHealth,
} from "../../../../hq/test/harness/runningCore.ts";
import { REAL_CORE_DEFAULTS } from "../harness/externalCore.ts";
import {
  openScenarioNavigation,
  startScenarioCore,
  type HqTimings,
  type ScenarioCore,
} from "../harness/hqCore.ts";
import { serve, deadline } from "../harness/http.ts";
import { personDoor } from "../harness/mateAccess.ts";
import { ZeropsFake } from "./zerops.ts";

type Periods = Required<HqTimings>;
const EMBEDDED_DEFAULTS: Periods = {
  pingEvery: 20_000,
  reconcileEvery: 60_000,
  streamRecheck: 30_000,
};

/** One value of the real Core's database, read as its owner. */
const valueOf = (url: string, query: string) => {
  const read = NodeChildProcess.spawnSync("psql", [url, "-X", "-tA", "-c", query], {
    encoding: "utf8",
  });
  if (read.status !== 0) throw new Error(`Core database read failed: ${read.stderr}`);
  return read.stdout.trim();
};

/**
 * The periods the real Core keeps: its socket pings and rechecks as the waits it starts on its held
 * clock, its reconcile as the interval its door queued the organisation's first one at.
 */
const realCoreSchedule = (core: Extract<ScenarioCore, { kind: "external" }>, expected: Periods) =>
  Effect.gen(function* () {
    const waits = yield* core.clock.until(
      (waits) => [expected.pingEvery, expected.streamRecheck].every((ms) => waits.includes(ms)),
      "Core ping/role-check waits",
    );
    const reconcile = Number(
      valueOf(
        core.url,
        `SELECT (EXTRACT(EPOCH FROM j.due_at - u.used_at) * 1000)::float8
           FROM hq_job j JOIN hq_org_use u USING (org_id) WHERE j.type = 'reconcile'`,
      ),
    );
    return [...waits, reconcile];
  });

it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
  const cases: [string, HqTimings, (kind: ScenarioCore["kind"]) => Periods][] = [
    [
      "production defaults",
      {},
      (kind) => (kind === "external" ? REAL_CORE_DEFAULTS : EMBEDDED_DEFAULTS),
    ],
    [
      "per-scenario overrides",
      { pingEvery: 40_000, reconcileEvery: 90_000, streamRecheck: 50_000 },
      () => ({ pingEvery: 40_000, reconcileEvery: 90_000, streamRecheck: 50_000 }),
    ],
  ];
  it.effect.each(
    Array.from(cases, ([name, timings, expected]) => ({
      title: `real Core schedules ${name} instead of rapid pings and role/structure rechecks`,
      timings,
      expected,
    })),
  )("$title", ({ timings, expected }) =>
    Effect.gen(function* () {
      const postgres = yield* TempPostgres;
      let clones = 0;
      const observedPostgres = TempPostgres.of({
        ...postgres,
        createMigratedDatabase: postgres.createMigratedDatabase.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              clones++;
            }),
          ),
        ),
      });
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
        const periods = expected(core.kind);
        const wanted = [periods.pingEvery, periods.reconcileEvery, periods.streamRecheck];
        if (core.kind === "external") {
          // The real Core takes the owner's Zerops access token at its door.
          fake.world.tokens.set("personal", {
            ...fake.world.tokens.get("door-owner")!,
            id: "personal",
          });
          fake.people.set("personal", "owner");
          const session = yield* personDoor(core, "owner", "hq");
          const socket = yield* openScenarioNavigation(
            core.origin,
            yield* ticketFor(core.call, session),
          );
          const schedule = yield* realCoreSchedule(core, periods);
          for (const milliseconds of wanted) expect(schedule).toContain(milliseconds);
          expect(schedule).not.toContain(200);
          expect(socket.readyState).toBe(WebSocket.OPEN);
          return;
        }
        yield* untilHealth(core.call, "active");
        expect(clones, "scenario Core consumes the existing migrated database helper").toBe(1);
        const session = yield* sessionFor(core.call, "door-owner");
        const ticket = yield* ticketFor(core.call, session);
        const socket = yield* openScenarioNavigation(core.origin, ticket);
        // Data delivery can precede starting the recheck timer. Wait for its scheduling receipt,
        // never a wall-time delay or an assumption about delivery ordering.
        yield* Effect.promise(() =>
          deadline(
            new Promise<void>((resolve) => {
              changed = () => {
                if (wanted.every((ms) => scheduled.includes(ms))) resolve();
              };
              changed();
            }),
            "Core ping/reconcile/role-check timer scheduling",
          ),
        );
        // Observe the clock boundary of running Core, not a copy of its configuration object.
        for (const milliseconds of wanted) expect(scheduled).toContain(milliseconds);
        expect(scheduled).not.toContain(200);
        expect(socket.readyState).toBe(WebSocket.OPEN);
      }).pipe(
        Effect.provideService(Clock.Clock, observed),
        Effect.provideService(TempPostgres, observedPostgres),
      );
    }),
  );
});
