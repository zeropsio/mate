// @effect-diagnostics nodeBuiltinImport:off -- real Core timers and real loopback websocket receipts.
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { WebSocket } from "ws";
import { seedCoreWorld, ticketFor } from "../../harness/coreSeed.ts";
import { REAL_CORE_DEFAULTS } from "../../harness/externalCore.ts";
import {
  openScenarioNavigation,
  startScenarioCore,
  type HqTimings,
  type ScenarioCore,
} from "../../harness/hqCore.ts";
import { serve } from "../../harness/http.ts";
import { personDoor } from "../../harness/mateAccess.ts";
import { ZeropsFake } from "../../fakes/zerops.ts";

type Periods = Required<HqTimings>;

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
const realCoreSchedule = (core: ScenarioCore, expected: Periods) =>
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

const cases: [string, HqTimings, Periods][] = [
  ["production defaults", {}, REAL_CORE_DEFAULTS],
  [
    "per-scenario overrides",
    { pingEvery: 40_000, reconcileEvery: 90_000, streamRecheck: 50_000 },
    { pingEvery: 40_000, reconcileEvery: 90_000, streamRecheck: 50_000 },
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
    const fake = new ZeropsFake(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG"));
    const api = yield* Effect.acquireRelease(
      Effect.promise(() => serve(fake.handle, fake.socket)),
      (api) => Effect.promise(api.close),
    );
    const core = yield* startScenarioCore(
      { baseUrl: `${api.origin}/api/rest/public`, world: fake.world },
      timings,
    );
    const wanted = [expected.pingEvery, expected.reconcileEvery, expected.streamRecheck];
    // The real Core takes the owner's Zerops access token at its door.
    fake.world.tokens.set("personal", {
      ...fake.world.tokens.get("door-owner")!,
      id: "personal",
    });
    fake.people.set("personal", "owner");
    const session = yield* personDoor(core, "owner", "hq");
    const socket = yield* openScenarioNavigation(core.origin, yield* ticketFor(core.call, session));
    const schedule = yield* realCoreSchedule(core, expected);
    for (const milliseconds of wanted) expect(schedule).toContain(milliseconds);
    expect(schedule).not.toContain(200);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  }),
);
