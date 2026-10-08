import { scopeReset } from "../test/harness/scopes.ts";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  OTHER_KEY_SECRET,
  TEST_KEY_SECRET,
  sealedFor,
  sealedSql,
  testKey,
} from "../test/harness/deployKeys.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Backup, type BackupStatus } from "./backup.ts";
import { deployKeysLayer } from "./deployKeys.ts";
import { GitHost, type GitState, type Quarantined } from "./gitHost.ts";
import { healthRoute } from "./health.ts";
import { LOCK_KEY, Leader, type LeaderStatus } from "./leader.ts";
import { LoopWatch, type LoopStatus } from "./loopWatch.ts";
import { Official, type OfficialStatus } from "./official.ts";
import { Recomputes } from "./recomputes.ts";

const QUIET: LoopStatus = { maxLagMs: 0, p99LagMs: 0, lastStall: null };

/**
 * `GET /health` for a leader in `status` and the official verdict, over a pool on `databaseUrl`;
 * the event loop's watch as `loop`, the structure's recomputes of the last minute `recomputes`;
 * git open while the leader is active, else closed, unless `git` says otherwise.
 */
const getHealth = (
  status: LeaderStatus,
  official: OfficialStatus["official"],
  databaseUrl: string,
  held: string | null = null,
  backup: BackupStatus = { state: "off" },
  loop: LoopStatus = QUIET,
  recomputes = 0,
  git: { readonly git: GitState; readonly quarantined: ReadonlyArray<Quarantined> } = {
    git: status.state === "active" ? "open" : "closed",
    quarantined: [],
  },
) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(healthRoute("b1"));
    const response = yield* handler.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://hq.test/health")),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Leader, {
            status: Effect.succeed(status),
            changes: Stream.make(status),
            nextAttempt: Effect.never,
            write: () => Effect.die("no writes"),
            release: Effect.void,
            hold: () => Effect.die("no hold"),
            held: Effect.succeed(held),
          }),
          Layer.succeed(Official, {
            status: Effect.succeed({ official, allowed: official === "ok" }),
            checked: Effect.succeed(true),
            nextCheck: Effect.never,
            lastOk: Effect.undefined,
            inherit: () => Effect.void,
          }),
          Layer.succeed(Backup, {
            nextCheck: Effect.never,
            take: Effect.die("no sets"),
            status: Effect.succeed(backup),
          }),
          Layer.succeed(LoopWatch, { status: Effect.succeed(loop) }),
          Layer.succeed(Recomputes, { count: Effect.void, lastMinute: Effect.succeed(recomputes) }),
          Layer.effect(
            GitHost,
            Effect.map(Queue.unbounded<never>(), (pushes) =>
              GitHost.of({
                nextAttempt: Effect.never,
                git: Effect.die("no git"),
                status: Effect.succeed(git),
                opened: () => Effect.die("no git"),
                serve: () => Effect.die("no git"),
                close: Effect.void,
                holdingRepos: (effect) => effect,
                recorded: Stream.make(0),
                pushes,
              }),
            ),
          ),
          // A fresh database has no tokens table to read: the key as the env gives it.
          deployKeysLayer(testKey()),
        ).pipe(
          Layer.provideMerge(
            PgClient.layer({
              url: Redacted.make(databaseUrl),
              connectTimeout: Duration.seconds(1),
            }),
          ),
        ),
      ),
    );
    const body: unknown = yield* Effect.promise(() => HttpServerResponse.toWeb(response).json());
    return { status: response.status, body, retryAfter: response.headers["retry-after"] };
  }).pipe(Effect.scoped);

/**
 * H5a: the readiness a rolling deploy waits on before it retires the Core that runs. An active Core
 * is ready once its git is open. A standby is ready while its database answers and either no Core
 * holds the lock — HQ's birth deploys Core before its anchor, and nothing runs to retire — or it
 * could lead itself, the official HQ by its own verdict.
 */
const cases: ReadonlyArray<{
  readonly leader: LeaderStatus;
  readonly official: OfficialStatus["official"];
  readonly database: "up" | "down";
  /** git as this Core holds it; open while active, else closed, unless given. */
  readonly git?: GitState;
  /** Another Core holds the lock: the one a deploy would retire. */
  readonly lockHeld?: true;
  readonly status: number;
}> = [
  { leader: { state: "active", epoch: 3 }, official: "ok", database: "up", status: 200 },
  // Leading, its takeover not through: nothing to retire the old Core for yet.
  {
    leader: { state: "active", epoch: 3 },
    official: "ok",
    database: "up",
    git: "opening",
    status: 503,
  },
  // No Core holds the lock, as at HQ's birth: a standby that is not the official HQ passes.
  {
    leader: { state: "standby", epoch: null },
    official: "anchor_missing",
    database: "up",
    status: 200,
  },
  // Another Core leads: only a standby that could lead itself may retire it.
  {
    leader: { state: "standby", epoch: null },
    official: "anchor_missing",
    database: "up",
    lockHeld: true,
    status: 503,
  },
  {
    leader: { state: "standby", epoch: null },
    official: "ok",
    database: "up",
    lockHeld: true,
    status: 200,
  },
  {
    leader: { state: "standby", epoch: null },
    official: "anchor_missing",
    database: "down",
    status: 503,
  },
  {
    leader: { state: "standby", epoch: null },
    official: "credentials_wrong",
    database: "up",
    status: 200,
  },
  { leader: { state: "starting", epoch: null }, official: "unknown", database: "up", status: 503 },
  {
    leader: { state: "failed", epoch: null },
    official: "anchor_elsewhere",
    database: "down",
    status: 503,
  },
];

describe("GET /health", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each(
      Array.from(cases, ({ leader, official, database, git, lockHeld, status }) => ({
        title: `answers ${String(status)} for ${leader.state}, ${official}, the database ${database}${
          git === undefined ? "" : `, git ${git}`
        }${lockHeld ? ", another Core leading" : ""}`,
        leader,
        official,
        database,
        git,
        lockHeld,
        status,
      })),
    )("$title", ({ leader, official, database, git, lockHeld, status }) =>
      Effect.gen(function* () {
        const postgres = yield* TempPostgres;
        const url = database === "up" ? yield* postgres.createDatabase : yield* postgres.deadUrl;
        if (lockHeld) {
          const other = yield* PgConnection.make({ url: Redacted.make(url) });
          yield* other.query(`SELECT pg_advisory_lock(${String(LOCK_KEY)})`);
        }
        const gitNow = git ?? (leader.state === "active" ? "open" : "closed");
        const response = yield* getHealth(leader, official, url, null, { state: "off" }, QUIET, 0, {
          git: gitNow,
          quarantined: [],
        });
        assert.strictEqual(response.status, status);
        // Every 503 HQ answers says when to try again.
        assert.strictEqual(response.retryAfter, status === 503 ? "5" : undefined);
        assert.deepStrictEqual(response.body, {
          state: leader.state,
          official,
          db: database,
          git: gitNow,
          backup: { state: "off" },
          keys: "ok",
          loop: QUIET,
          recomputes: 0,
          epoch: leader.epoch,
          build: "b1",
        });
      }),
    );

    it.effect("ignores leadership locks in another database when deciding readiness", () =>
      Effect.gen(function* () {
        const postgres = yield* TempPostgres;
        const foreignUrl = yield* postgres.createDatabase;
        const foreign = yield* PgConnection.make({ url: Redacted.make(foreignUrl) });
        yield* foreign.query(`SELECT pg_advisory_lock(${String(LOCK_KEY)})`);
        const ownUrl = yield* postgres.createDatabase;
        const response = yield* getHealth(
          { state: "standby", epoch: null },
          "anchor_elsewhere",
          ownUrl,
        );
        assert.strictEqual(response.status, 200);
      }),
    );

    // A Core holding the lock over records and git that disagree says why (`reconcile.ts`).
    it.effect("names why a held Core serves nothing", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const response = yield* getHealth(
          { state: "failed", epoch: null },
          "ok",
          url,
          "restore_mismatch",
        );
        assert.deepStrictEqual(
          [response.status, response.body],
          [
            503,
            {
              state: "failed",
              reason: "restore_mismatch",
              official: "ok",
              db: "up",
              git: "closed",
              backup: { state: "off" },
              keys: "ok",
              loop: QUIET,
              recomputes: 0,
              epoch: null,
              build: "b1",
            },
          ],
        );
      }),
    );

    // Backup is reported, never judged: a readiness check must not fail over a set.
    it.effect("tells a failed backup and still answers 200", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const backup: BackupStatus = {
          state: "failed",
          reason: "pg_dump_older",
          pgDump: 16,
          server: 18,
        };
        const response = yield* getHealth({ state: "active", epoch: 3 }, "ok", url, null, backup);
        assert.deepStrictEqual(
          [response.status, response.body],
          [
            200,
            {
              state: "active",
              official: "ok",
              db: "up",
              git: "open",
              backup,
              keys: "ok",
              loop: QUIET,
              recomputes: 0,
              epoch: 3,
              build: "b1",
            },
          ],
        );
      }),
    );

    // F22 (2026-10-03): /health answered after 52.7 s with 40 GETs, the event loop not running.
    // What it measures since is reported, never judged.
    it.effect(
      "reports the event loop's watch and the structure's recomputes, and still answers 200",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const loop: LoopStatus = {
            maxLagMs: 52_700,
            p99LagMs: 40,
            lastStall: {
              at: "2026-10-03T08:38:29.240Z",
              lateMs: 51_700,
              cpuMs: 30,
              longestWriteMs: 51_650,
            },
          };
          const response = yield* getHealth(
            { state: "active", epoch: 3 },
            "ok",
            url,
            null,
            { state: "off" },
            loop,
            480,
          );
          assert.deepStrictEqual(
            [response.status, response.body],
            [
              200,
              {
                state: "active",
                official: "ok",
                db: "up",
                git: "open",
                backup: { state: "off" },
                keys: "ok",
                loop,
                recomputes: 480,
                epoch: 3,
                build: "b1",
              },
            ],
          );
        }),
    );

    it.effect("counts a structure socket's views in a running Core, beside its loop's watch", () =>
      Effect.gen(function* () {
        const { call, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const watching = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`);
        yield* scopeReset(watching, { kind: "navigation" });
        const health = (yield* call("GET", "/health")).body as {
          readonly loop: LoopStatus;
          readonly recomputes: number;
        };
        yield* watching.close;
        assert.deepStrictEqual(Object.keys(health.loop), ["maxLagMs", "p99LagMs", "lastStall"]);
        assert.isAtLeast(health.recomputes, 1);
      }),
    );

    // HQ's key is reported, never judged: a Core without one leads and deploys nothing
    // (`deployKeys.ts`); a token sealed under another key opens nowhere here.
    it.effect.each<[string, string | null, ReadonlyArray<string>, string]>([
      ["no key", null, [], "no_secret"],
      ["a key that is no key", "not-a-key", [], "bad_secret"],
      ["its key and no token", TEST_KEY_SECRET, [], "ok"],
      ["its key and a token sealed under it", TEST_KEY_SECRET, [TEST_KEY_SECRET], "ok"],
      [
        "its key and a token sealed under another",
        TEST_KEY_SECRET,
        [TEST_KEY_SECRET, OTHER_KEY_SECRET],
        "other_secret",
      ],
    ])("tells HQ's key with %s, and still answers 200", ([, keySecret, sealedUnder, keys]) =>
      Effect.gen(function* () {
        const { call, url } = yield* startCore(true, { keySecret });
        yield* untilHealth(call, "active");
        for (const [n, raw] of sealedUnder.entries()) {
          const projectId = `P_ENV${String(n)}`;
          yield* rowsWhere(
            url,
            `WITH app AS (
               INSERT INTO hq_app (name, created_by) VALUES ('App ${String(n)}', 'owner')
               RETURNING id),
             placed AS (
               INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
               SELECT '${projectId}', id, 'stage', 'owner' FROM app RETURNING project_id, app_id),
             environment AS (
               INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
               SELECT project_id, app_id, 'stage', 'stage', '{main}', 'owner' FROM placed
               RETURNING project_id)
             INSERT INTO hq_deploy_token (project_id, key_id, sealed, kept_by)
             SELECT project_id, ${sealedSql(sealedFor(projectId, "a-token", raw))}, 'owner'
             FROM environment RETURNING 1`,
            (rows) => rows.length === 1,
          );
        }
        // Active is ready once git is open: HQ's key never holds that back.
        const health = yield* call("GET", "/health").pipe(
          Effect.filterOrFail((response) => response.status === 200),
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(10)),
        );
        assert.strictEqual((health.body as { readonly keys: string }).keys, keys);
      }),
    );

    // H2: git as this Core holds it, and the repositories it quarantined, reported.
    it.effect("tells where git stands and lists the repositories it quarantined", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const quarantined = [{ repo: "A1/web", reason: "converge_git_failed" }];
        const response = yield* getHealth(
          { state: "active", epoch: 3 },
          "ok",
          url,
          null,
          { state: "off" },
          QUIET,
          0,
          { git: "open", quarantined },
        );
        assert.deepStrictEqual(
          [response.status, response.body],
          [
            200,
            {
              state: "active",
              official: "ok",
              db: "up",
              git: "open",
              quarantined,
              backup: { state: "off" },
              keys: "ok",
              loop: QUIET,
              recomputes: 0,
              epoch: 3,
              build: "b1",
            },
          ],
        );
      }),
    );
  });
});
