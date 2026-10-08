import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import { OTHER_KEY_SECRET, TEST_KEY_SECRET, testKey } from "../test/harness/deployKeys.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  type KeySecret,
  type KeySecretOk,
  type Sealed,
  keySecretOf,
  openToken,
  sealPlainTokens,
  sealToken,
} from "./deployKeys.ts";
import { Leader, leaderLayer } from "./leader.ts";
import { treeMigrations } from "./migrationFiles.ts";
import type { Migration } from "./migrations.ts";
import { Official } from "./official.ts";

const read = (raw: string | undefined) =>
  keySecretOf(raw === undefined ? Option.none() : Option.some(Redacted.make(raw)));

describe("HQ_KEY_SECRET", () => {
  // `openssl rand -base64 32`, or what HQ's birth writes: 32 bytes, base64 with its padding.
  it.each<[string, string | undefined, "ok" | "no_secret" | "bad_secret"]>([
    ["none", undefined, "no_secret"],
    ["empty", "", "no_secret"],
    ["32 bytes", TEST_KEY_SECRET, "ok"],
    ["32 bytes, a line after it", `${TEST_KEY_SECRET}\n`, "ok"],
    ["31 bytes", Buffer.alloc(31, 7).toString("base64"), "bad_secret"],
    ["33 bytes", Buffer.alloc(33, 7).toString("base64"), "bad_secret"],
    ["no padding", TEST_KEY_SECRET.replace(/=$/u, ""), "bad_secret"],
    ["base64url", Buffer.alloc(32, 0xfb).toString("base64url"), "bad_secret"],
    ["hex", Buffer.alloc(32, 7).toString("hex"), "bad_secret"],
  ])("reads %s as %s", (_name, raw, state) => {
    assert.strictEqual(read(raw).state, state);
  });

  // What a sealed token carries beside it: which key, and which way it was sealed.
  it("names a key by an id of its own, versioned, that is no part of it", () => {
    const idOf = (raw: string) => {
      const secret = read(raw);
      return secret.state === "ok" ? secret.id : "";
    };
    assert.match(idOf(TEST_KEY_SECRET), /^v1-[0-9a-f]{16}$/u);
    assert.strictEqual(idOf(TEST_KEY_SECRET), idOf(`${TEST_KEY_SECRET}\n`));
    assert.notStrictEqual(idOf(TEST_KEY_SECRET), idOf(OTHER_KEY_SECRET));
    assert.notInclude(
      Buffer.from(TEST_KEY_SECRET, "base64").toString("hex"),
      idOf(TEST_KEY_SECRET).slice(3),
    );
  });
});

describe("a sealed deploy token", () => {
  const key = testKey(TEST_KEY_SECRET);
  const other = testKey(OTHER_KEY_SECRET);
  const VALUE = "zerops-deploy-token-value";
  const sealed = sealToken(key, "P_STAGE", Redacted.make(VALUE));
  const flipped = Buffer.from(sealed.sealed);
  flipped[flipped.length - 1]! ^= 1;

  // Bound to its row: a token copied onto another environment's row does not open there.
  it.each<[string, KeySecretOk, string, Sealed, string | undefined]>([
    ["under its key, on its project's row", key, "P_STAGE", sealed, VALUE],
    ["under another key", other, "P_STAGE", sealed, undefined],
    ["on another project's row", key, "P_PROD", sealed, undefined],
    ["a byte changed", key, "P_STAGE", { ...sealed, sealed: flipped }, undefined],
    ["cut short", key, "P_STAGE", { ...sealed, sealed: sealed.sealed.subarray(0, 20) }, undefined],
    ["naming another key", key, "P_STAGE", { ...sealed, keyId: other.id }, undefined],
  ])("opens %s: %s", (_name, under, projectId, given, opened) => {
    const token = openToken(under, projectId, given);
    assert.strictEqual(token === undefined ? undefined : Redacted.value(token), opened);
  });

  it("carries its key's id and none of its value, and differs each time it is sealed", () => {
    const again = sealToken(key, "P_STAGE", Redacted.make(VALUE));
    assert.deepStrictEqual([sealed.keyId, again.keyId], [key.id, key.id]);
    assert.notStrictEqual(
      Buffer.from(again.sealed).toString("hex"),
      Buffer.from(sealed.sealed).toString("hex"),
    );
    for (const bytes of [sealed.sealed, again.sealed]) {
      assert.notInclude(Buffer.from(bytes).toString("latin1"), VALUE);
    }
  });
});

/** The migration that seals the deploy tokens, and every file before it. */
const SEALING = "0028_sealed_deploy_tokens.sql";
const beforeSealing = () => treeMigrations().filter((file) => file.name < SEALING);

/**
 * A leader over `url`, the official HQ, leading once it has run `migrations` and sealed the plain
 * tokens under `secret` (none: the files before the sealing one, no pass); stopped by `stop`.
 */
const leading = (url: string, secret: KeySecret | null, migrations?: ReadonlyArray<Migration>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const databaseUrl = Redacted.make(url);
    const context = yield* Layer.buildWithScope(
      leaderLayer({
        databaseUrl,
        migrations: migrations ?? (secret === null ? beforeSealing() : treeMigrations()),
        ...(secret === null ? {} : { afterMigrations: sealPlainTokens(secret) }),
        heartbeat: Duration.millis(100),
        retryAfter: Duration.millis(100),
      }).pipe(
        Layer.provideMerge(PgClient.layer({ url: databaseUrl })),
        Layer.provide(
          Layer.succeed(Official, {
            status: Effect.succeed({ official: "ok" as const, allowed: true }),
            checked: Effect.succeed(true),
            lastOk: Effect.undefined,
            inherit: () => Effect.void,
          }),
        ),
      ),
      scope,
    );
    yield* Context.get(context, Leader).status.pipe(
      Effect.filterOrFail((status) => status.state === "active"),
      Effect.retry(Schedule.spaced(Duration.millis(50))),
      Effect.timeout(Duration.seconds(10)),
    );
    return { sql: Context.get(context, SqlClient.SqlClient), stop: Scope.close(scope, Exit.void) };
  });

/** Shop's stage and production, each with the deploy token an admin kept before tokens were sealed. */
const PLAIN = { P_STAGE: "key-stage-plain", P_PROD: "key-prod-plain" } as const;

const keptPlain = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
    for (const [projectId, tier] of [
      ["P_STAGE", "stage"],
      ["P_PROD", "production"],
    ] as const) {
      yield* sql`
        INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
        VALUES (${projectId}, ${app!.id}::uuid, ${tier}, 'owner')`;
      yield* sql`
        INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
        VALUES (${projectId}, ${app!.id}::uuid, ${tier}, ${tier},
                ${tier === "stage" ? "{main}" : "{release}"}, 'owner')`;
      yield* sql`
        INSERT INTO hq_deploy_token (project_id, token, kept_by)
        VALUES (${projectId}, ${PLAIN[projectId]}, 'owner')`;
    }
  });

/** Each row's token as it is kept: its key's id and its bytes, in hex. */
const keptRows = (sql: SqlClient.SqlClient) =>
  sql<{ readonly project_id: string; readonly key_id: string | null; readonly sealed: Uint8Array }>`
    SELECT project_id, key_id, sealed FROM hq_deploy_token ORDER BY project_id`;

describe("the deploy tokens kept before they were sealed", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("are sealed at the leading Core's start, under the lead's lock, once", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const before = yield* leading(url, null);
        yield* keptPlain(before.sql);
        yield* before.stop;

        const key = testKey(TEST_KEY_SECRET);
        const first = yield* leading(url, key);
        const sealed = yield* keptRows(first.sql);
        assert.deepStrictEqual(
          sealed.map((row) => {
            const token = openToken(key, row.project_id, {
              keyId: row.key_id ?? "",
              sealed: row.sealed,
            });
            return [row.project_id, row.key_id, token && Redacted.value(token)];
          }),
          [
            ["P_PROD", key.id, PLAIN.P_PROD],
            ["P_STAGE", key.id, PLAIN.P_STAGE],
          ],
        );
        // The plain column is gone: the bytes are the sealed ones.
        const columns = yield* first.sql<{ readonly name: string }>`
          SELECT column_name AS name FROM information_schema.columns
          WHERE table_name = 'hq_deploy_token' ORDER BY column_name`;
        assert.notInclude(
          columns.map((column) => column.name),
          "token",
        );
        yield* first.stop;

        // A second start finds nothing plain and seals nothing again.
        const second = yield* leading(url, key);
        const again = yield* keptRows(second.sql);
        assert.deepStrictEqual(
          again.map((row) => Buffer.from(row.sealed).toString("hex")),
          sealed.map((row) => Buffer.from(row.sealed).toString("hex")),
        );
        yield* second.stop;
      }),
    );

    // A Core started before its key was set leads; what it cannot seal it leaves as it was.
    it.effect.each<[string, string | undefined]>([
      ["no key", undefined],
      ["a key that is no key", "not-a-key"],
    ])("are left plain by a Core with %s, and sealed at the start of one with the key", ([, raw]) =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const before = yield* leading(url, null);
        yield* keptPlain(before.sql);
        yield* before.stop;

        const keyless = yield* leading(url, read(raw));
        assert.deepStrictEqual(
          (yield* keptRows(keyless.sql)).map((row) => [
            row.project_id,
            row.key_id,
            Buffer.from(row.sealed).toString("utf8"),
          ]),
          [
            ["P_PROD", null, PLAIN.P_PROD],
            ["P_STAGE", null, PLAIN.P_STAGE],
          ],
        );
        yield* keyless.stop;

        const key = testKey(TEST_KEY_SECRET);
        const keyed = yield* leading(url, key);
        assert.deepStrictEqual(
          (yield* keptRows(keyed.sql)).map((row) => row.key_id),
          [key.id, key.id],
        );
        yield* keyed.stop;
      }),
    );
  });
});
