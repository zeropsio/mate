// @effect-diagnostics nodeBuiltinImport:off -- a set restores from files: pg_restore reads one, git the others.
/**
 * A backup set made HQ again (vysledky/hq-backup.md §5), into an empty database and an empty git
 * root while no Core runs on them. Nothing is written before every file of the set is fetched and
 * matches its manifest's digest; a set without its manifest is refused. The database restores with
 * `pg_restore`, every person's session then revoked (a sign-out after the set would otherwise come
 * back); each repository restores from its bundle (`@t3tools/hq-git` `restore`). The next Core's
 * takeover records what git holds beyond the database (`reconcile.ts`).
 *
 * `restoreDatabase` and `restoreRepos` are the two halves; `restoreSet` runs both from one set.
 *
 * @module restore
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { makeHqGit } from "@t3tools/hq-git";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

import {
  type BackupStore,
  BackupError,
  type Manifest,
  decodeManifest,
  digestOf,
  libpqEnv,
  runTool,
  setKey,
} from "./backup.ts";
import { LOCK_KEY } from "./leader.ts";

export interface RestoreTarget {
  readonly databaseUrl: Redacted.Redacted;
  /** The git root the repositories restore into: the volume's `/mnt/vol/git`. */
  readonly gitRoot: string;
  /** Where the set's files are fetched to. */
  readonly workDir: string;
  /** The `pg_restore` to run; the one on the path. */
  readonly pgRestore?: string;
}

const fail = (reason: BackupError["reason"], message: string) =>
  Effect.fail(new BackupError({ reason, message }));

const local = (workDir: string, file: string) => NodePath.join(workDir, ...file.split("/"));

/** The set's manifest, from the store. */
const manifestOf = (store: BackupStore, id: string, workDir: string) =>
  Effect.gen(function* () {
    const file = NodePath.join(workDir, "manifest.json");
    const present = yield* store.list(setKey(id, "manifest.json"));
    if (present.length === 0) return yield* fail("manifest_missing", `set ${id} has no manifest`);
    yield* store.get(setKey(id, "manifest.json"), file);
    const text = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(file, "utf8"),
      catch: () => new BackupError({ reason: "manifest_unreadable", message: `set ${id}` }),
    });
    return yield* decodeManifest(text).pipe(
      Effect.mapError(
        () => new BackupError({ reason: "manifest_unreadable", message: `set ${id}` }),
      ),
    );
  });

/** A file of the set, fetched and matched to its digest. */
const fetched = (store: BackupStore, id: string, workDir: string, file: string, sha256: string) =>
  Effect.gen(function* () {
    const path = local(workDir, file);
    yield* store.get(setKey(id, file), path);
    const digest = yield* digestOf(path);
    if (digest !== sha256) return yield* fail("digest_mismatch", `${file} of set ${id}`);
    return path;
  });

/** Every file of the set fetched and checked: its manifest and their local paths. */
const fetchSet = (store: BackupStore, id: string, workDir: string) =>
  Effect.gen(function* () {
    const manifest = yield* manifestOf(store, id, workDir);
    const dump = yield* fetched(
      store,
      id,
      workDir,
      manifest.database.file,
      manifest.database.sha256,
    );
    const bundles = new Map<string, string>();
    for (const repo of manifest.repos) {
      if (repo.file === null || repo.sha256 === null) continue;
      bundles.set(
        `${repo.appId}/${repo.id}`,
        yield* fetched(store, id, workDir, repo.file, repo.sha256),
      );
    }
    return { manifest, dump, bundles };
  });

/** The database from `dump`: refused unless empty and no Core holds it; sessions revoked. */
const databaseFrom = (dump: string, target: RestoreTarget) =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* PgConnection.make({ url: target.databaseUrl }).pipe(
        Effect.mapError((error) => new BackupError({ reason: "tool", message: error.message })),
      );
      const query = (statement: string) =>
        connection
          .query(statement)
          .pipe(
            Effect.mapError((error) => new BackupError({ reason: "tool", message: error.message })),
          );
      const locked = yield* query(`SELECT pg_try_advisory_lock(${String(LOCK_KEY)}) AS locked`);
      if (locked.rows[0]?.["locked"] !== true) {
        return yield* fail("core_running", "a Core holds this database's lock: stop it first");
      }
      const tables = yield* query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
      );
      if (Number(tables.rows[0]?.["n"] ?? 0) > 0) {
        return yield* fail("target_not_empty", "the database has tables already");
      }
      yield* runTool(
        target.pgRestore ?? "pg_restore",
        [
          "--no-owner",
          "--no-acl",
          "--exit-on-error",
          `--dbname=${libpqEnv(target.databaseUrl)["PGDATABASE"] ?? ""}`,
          dump,
        ],
        target.databaseUrl,
      );
      yield* query("UPDATE hq_session SET revoked_at = now() WHERE revoked_at IS NULL");
    }),
  );

/** The repositories from their bundles, into an empty git root. */
const reposFrom = (manifest: Manifest, bundles: ReadonlyMap<string, string>, gitRoot: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const git = yield* makeHqGit({
        rootDir: gitRoot,
        authenticate: () => null,
        canRead: () => false,
        lookupChange: async () => null,
      });
      if ((yield* git.list()).length > 0) {
        return yield* fail("target_not_empty", "the git root has repositories already");
      }
      for (const repo of manifest.repos) {
        yield* git.restore(
          { appId: repo.appId, id: repo.id },
          bundles.get(`${repo.appId}/${repo.id}`) ?? null,
        );
      }
    }),
  );

/** Set `id`'s database, into an empty database no Core holds. */
export const restoreDatabase = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.flatMap(fetchSet(store, id, target.workDir), ({ dump }) => databaseFrom(dump, target));

/** Set `id`'s repositories, into an empty git root. */
export const restoreRepos = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.flatMap(fetchSet(store, id, target.workDir), ({ manifest, bundles }) =>
    reposFrom(manifest, bundles, target.gitRoot),
  );

/** Set `id` whole: every file checked first, then the database, then the repositories. */
export const restoreSet = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.gen(function* () {
    const { manifest, dump, bundles } = yield* fetchSet(store, id, target.workDir);
    yield* databaseFrom(dump, target);
    yield* reposFrom(manifest, bundles, target.gitRoot);
    return manifest;
  });
