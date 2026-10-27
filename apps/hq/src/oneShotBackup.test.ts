// @effect-diagnostics nodeBuiltinImport:off -- the test builds repositories with git and reads the set's files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import { LEGACY_TABLES, legacySetRefusal } from "../test/harness/legacySetCheck.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { BackupError, decodeManifest } from "./backup.ts";
import { takeOneShotSet } from "./oneShotBackup.ts";

/** What every `bytea` column holds: a sealed value, as stored. */
const SEALED = "\\x00ff10ab";
/** What every text column holds. */
const TEXT = 'line one\nline "two" \\ ✓';

/**
 * One row in every table that has none, each column given a value of its type: text with a line
 * break and quotes, JSON, `bytea`. Checks, foreign keys and triggers are out of the way, so no row
 * needs another; the rows the migrations seed stay as they are.
 */
const EVERY_TABLE = String.raw`DO $populate$
DECLARE t record; c record; cols text[]; vals text[]; filled boolean;
BEGIN
  SET LOCAL session_replication_role = replica;
  FOR t IN SELECT con.conrelid::regclass AS rel, con.conname FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = 'public' AND con.contype = 'c'
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', t.rel, t.conname); END LOOP;
  FOR t IN SELECT format('%I', tablename) AS rel FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT EXISTS (SELECT FROM %s)', t.rel) INTO filled;
    CONTINUE WHEN filled;
    cols := '{}'; vals := '{}';
    FOR c IN SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid = t.rel::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = '' AND a.attidentity <> 'a' ORDER BY a.attnum
    LOOP
      cols := cols || quote_ident(c.attname);
      vals := vals || CASE
        WHEN c.type LIKE '%[]' THEN '''{}'''
        WHEN c.type IN ('text', 'character varying') THEN quote_literal(E'line one\nline "two" \\ ✓')
        WHEN c.type IN ('json', 'jsonb') THEN quote_literal('{"k": ["v\n", 1]}')
        WHEN c.type = 'bytea' THEN quote_literal('${SEALED}') || '::bytea'
        WHEN c.type = 'uuid' THEN 'gen_random_uuid()'
        WHEN c.type LIKE 'timestamp%' THEN 'now()'
        WHEN c.type = 'date' THEN 'current_date'
        WHEN c.type = 'interval' THEN '''1 hour'''
        WHEN c.type = 'boolean' THEN 'true'
        ELSE '1' END;
    END LOOP;
    EXECUTE format('INSERT INTO %s (%s) VALUES (%s)', t.rel, array_to_string(cols, ','), array_to_string(vals, ','));
  END LOOP;
END $populate$`;

const run = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();

/** A git root holding app `app`'s repository `group` with one commit and GitHub's copy of it, and an empty `notes`. */
const gitRootIn = (dir: string) => {
  const work = NodePath.join(dir, "work");
  NodeFS.mkdirSync(work);
  run(work, ["init", "-q", "-b", "main"]);
  run(work, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "one",
  ]);
  const root = NodePath.join(dir, "git");
  NodeFS.mkdirSync(NodePath.join(root, "app"), { recursive: true });
  run(dir, ["clone", "-q", "--bare", work, NodePath.join(root, "app", "group.git")]);
  const head = run(work, ["rev-parse", "HEAD"]);
  run(NodePath.join(root, "app", "group.git"), ["update-ref", "refs/github/heads/main", head]);
  run(dir, ["init", "-q", "--bare", NodePath.join(root, "app", "notes.git")]);
  return { root, head };
};

describe("one-shot backup", () => {
  it.effect(
    "a one-shot backup of a Core with every table populated writes a set the shared HQ's legacy import accepts, every row and sealed value as stored",
    () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createMigratedDatabase;
        const counts = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.withTransaction(sql.unsafe(EVERY_TABLE));
          const tables = yield* sql<{
            readonly name: string;
          }>`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`;
          const counts = new Map<string, number>();
          for (const { name } of tables) {
            const [row] = yield* sql.unsafe<{ readonly n: number }>(
              `SELECT count(*)::int AS n FROM ${name}`,
            );
            counts.set(name, row?.n ?? 0);
          }
          return counts;
        }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
        const scratch = yield* tempDir("hq-one-shot-");
        const { root, head } = gitRootIn(scratch);
        const dir = NodePath.join(scratch, "set");

        const manifest = yield* takeOneShotSet({
          databaseUrl: Redacted.make(url),
          dir,
          gitRoot: root,
        });

        const read = yield* Effect.promise(() => legacySetRefusal(dir));
        assert.notProperty(read, "refused", "refused" in read ? read.refused : "");
        if (!("tables" in read)) return;
        assert.deepStrictEqual([...read.tables.keys()].toSorted(), [...LEGACY_TABLES].toSorted());
        for (const table of LEGACY_TABLES) {
          assert.isAbove(counts.get(table) ?? 0, 0, table);
          assert.strictEqual(read.tables.get(table)?.length, counts.get(table), table);
        }
        const token = read.tables.get("hq_deploy_token")?.[0];
        assert.deepStrictEqual([token?.["sealed"], token?.["key_id"]], [SEALED, TEXT]);
        // `restore` reads it as any other set.
        const restorable = yield* decodeManifest(
          NodeFS.readFileSync(NodePath.join(dir, "manifest.json"), "utf8"),
        );
        assert.strictEqual(restorable.database.sha256, manifest.database.sha256);
        assert.deepStrictEqual(
          manifest.repos.map((repo) => [repo.appId, repo.id, repo.file, repo.refs]),
          [
            ["app", "group", "git/app/group.bundle", [{ ref: "refs/heads/main", sha: head }]],
            ["app", "notes", null, []],
          ],
        );
      }).pipe(Effect.provide(tempPostgresLayer)),
    60_000,
  );

  it.effect("a one-shot backup refuses a directory that already holds files", () =>
    Effect.gen(function* () {
      const scratch = yield* tempDir("hq-one-shot-");
      NodeFS.writeFileSync(NodePath.join(scratch, "manifest.json"), "{}");
      const error = yield* Effect.flip(
        takeOneShotSet({
          databaseUrl: Redacted.make("postgres://nobody@127.0.0.1:1/none"),
          dir: scratch,
          gitRoot: scratch,
        }),
      );
      assert.deepStrictEqual(
        error,
        new BackupError({ reason: "target_not_empty", message: `${scratch} holds files already` }),
      );
      assert.deepStrictEqual(NodeFS.readdirSync(scratch), ["manifest.json"]);
    }),
  );
});
