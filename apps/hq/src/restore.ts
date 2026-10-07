// @effect-diagnostics nodeBuiltinImport:off -- a set restores from files: pg_restore reads one, git the others.
/**
 * A backup set made HQ again (vysledky/hq-backup.md §5, §10), into an empty database and an empty
 * git root while no Core runs on them. Nothing is written before every file of the set is fetched
 * and matches its manifest's digest, and both targets are found fit; a set without its manifest is
 * refused. The database restores with `pg_restore`, every person's session then revoked (a sign-out
 * after the set would otherwise come back); each repository restores from its bundle
 * (`@t3tools/hq-git` `restore`). The next Core's takeover records what git holds beyond the
 * database (`reconcile.ts`).
 *
 * With `replace`, a live HQ's targets are emptied first, and kept: the database dumped into the work
 * directory (`before-<time>.dump`), then its tables dropped (the service's user may not drop the
 * schema, §10); the git root moved aside (`<root>.before-<time>`). The epoch never goes back: the
 * restored one is set above the one the live HQ led under, so no write of a Core from before passes
 * the leader's fence (`leader.ts`). Without `replace` the database is empty and takes the set's.
 *
 * Each restore holds the database's lock (`leader.ts` `LOCK_KEY`) from its first look at a target to
 * its last write, refused while a Core holds it: no Core leads in the middle of one, and none runs
 * while a git root is moved aside or filled (H3). A git root is looked at as the disk lists it,
 * never through the git layer, whose opening sweeps what a running Core has in flight.
 *
 * `restoreDatabase` and `restoreRepos` are the two halves; `restoreSet` runs both from one set.
 *
 * @module restore
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { makeHqGit } from "@t3tools/hq-git";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

import {
  type BackupStore,
  BackupError,
  type Manifest,
  decodeManifest,
  digestOf,
  io,
  libpqEnv,
  pgDumpFits,
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
  /** The `pg_restore` to run, and the `pg_dump` that keeps a replaced database; those on the path. */
  readonly pgRestore?: string;
  readonly pgDump?: string;
  /** Whether a live HQ's database and git root are kept aside and replaced; else they must be empty. */
  readonly replace?: boolean;
}

/** What a restore kept of the HQ it replaced: the database's dump and the git root's new place. */
export interface Kept {
  readonly dump: string | null;
  readonly git: string | null;
}

/** Every table of `public` dropped, and with them their indexes and owned sequences. */
const DROP_TABLES = `DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE 'DROP TABLE IF EXISTS ' || t || ' CASCADE'; END LOOP;
END $$`;

// Table replacement also replaces migration-owned routines and aggregates.
const DROP_USAGE_ROUTINES = `DO $$ DECLARE routine record; BEGIN
  FOR routine IN SELECT p.oid,p.prokind,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hq_usage_%'
  LOOP EXECUTE 'DROP ' || CASE WHEN routine.prokind='a' THEN 'AGGREGATE' ELSE 'FUNCTION' END || ' IF EXISTS ' || routine.signature || ' CASCADE'; END LOOP;
END $$`;

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

/**
 * The database's lock, held for the scope on a connection of its own: refused while a Core holds
 * it. Its queries.
 */
const exclusive = (target: RestoreTarget) =>
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
    return query;
  });

type Query = Effect.Success<ReturnType<typeof exclusive>>;

/**
 * The database from `dump`, its lock held (`exclusive`): unless empty or `replace`d (kept in
 * `workDir/before-<stamp>.dump`, then its tables dropped); sessions revoked; the epoch above the one
 * it replaced. The kept dump's path.
 */
const databaseFrom = (dump: string, target: RestoreTarget, stamp: string, query: Query) =>
  Effect.gen(function* () {
    const count = (statement: string) =>
      Effect.map(query(statement), (result) => Number(result.rows[0]?.["n"] ?? 0));
    let kept: string | null = null;
    let led: number | null = null;
    if (
      (yield* count("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")) > 0
    ) {
      if (target.replace !== true) {
        return yield* fail("target_not_empty", "the database has tables already");
      }
      // The epoch it led under, read before anything goes.
      if ((yield* count("SELECT count(to_regclass('public.hq_leader'))::int AS n")) > 0) {
        led = Number((yield* query("SELECT epoch FROM hq_leader WHERE id = 1")).rows[0]?.["epoch"]);
      }
      const version = yield* query("SELECT current_setting('server_version_num') AS v");
      const pgDump = target.pgDump ?? "pg_dump";
      yield* pgDumpFits(pgDump, target.databaseUrl, String(version.rows[0]?.["v"] ?? ""));
      kept = NodePath.join(target.workDir, `before-${stamp}.dump`);
      yield* io("keep", () => NodeFSP.mkdir(target.workDir, { recursive: true }));
      yield* runTool(
        pgDump,
        ["--format=custom", "--no-owner", "--no-acl", `--file=${kept}`],
        target.databaseUrl,
      );
      yield* query(DROP_TABLES);
      yield* query(DROP_USAGE_ROUTINES);
      const left = yield* count(`
          SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'`);
      if (left > 0) {
        return yield* fail("target_not_empty", `${String(left)} relations remain in public`);
      }
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
    if (
      (yield* query("SELECT to_regclass('public.hq_usage_state') IS NOT NULL AS present"))
        .rows[0]?.["present"] === true
    ) {
      yield* query(
        "UPDATE hq_usage_state SET recovery='partial',protection_verified=false,protected_revision=NULL,protected_set=NULL,revision=revision+1 WHERE id=1",
      );
      yield* query("DELETE FROM hq_usage_sender");
    }
    // Older sets predate person Git passwords; restored ones never revive an old password.
    if (
      (yield* query("SELECT to_regclass('public.hq_git_credential') IS NOT NULL AS present"))
        .rows[0]?.["present"] === true
    ) {
      yield* query("UPDATE hq_git_credential SET revoked_at = now() WHERE revoked_at IS NULL");
    }
    if (led !== null && Number.isSafeInteger(led)) {
      yield* query(`UPDATE hq_leader SET epoch = GREATEST(epoch, ${String(led + 1)}) WHERE id = 1`);
    }
    return kept;
  });

/**
 * How many repositories lie under `gitRoot` (`<appId>/<repo>.git`), as the disk lists them: nothing
 * swept or recovered, as opening the git layer would.
 */
const reposIn = (gitRoot: string) =>
  io("inspect", async () => {
    let found = 0;
    for (const app of await NodeFSP.readdir(gitRoot, { withFileTypes: true }).catch(() => [])) {
      if (!app.isDirectory() || app.name.startsWith(".")) continue;
      const entries = await NodeFSP.readdir(NodePath.join(gitRoot, app.name), {
        withFileTypes: true,
      }).catch(() => []);
      found += entries.filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && entry.name.endsWith(".git"),
      ).length;
    }
    return found;
  });

/** The git root empty: refused unless it is, or `replace`d (moved aside); its new place. */
const gitRootCleared = (target: RestoreTarget, stamp: string) =>
  Effect.gen(function* () {
    if ((yield* reposIn(target.gitRoot)) === 0) return null;
    if (target.replace !== true) {
      return yield* fail("target_not_empty", "the git root has repositories already");
    }
    const aside = `${target.gitRoot}.before-${stamp}`;
    yield* io("keep", async () => {
      await NodeFSP.rename(target.gitRoot, aside);
      await NodeFSP.mkdir(target.gitRoot);
    });
    return aside;
  });

/** The repositories from their bundles, into a git root `gitRootCleared` left empty. */
const reposFrom = (manifest: Manifest, bundles: ReadonlyMap<string, string>, gitRoot: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const git = yield* makeHqGit({
        rootDir: gitRoot,
        authenticate: () => null,
        canRead: () => false,
        lookupChange: async () => null,
      });
      for (const repo of manifest.repos) {
        yield* git.restore(
          { appId: repo.appId, id: repo.id },
          bundles.get(`${repo.appId}/${repo.id}`) ?? null,
        );
      }
    }),
  );

/** When a restore runs, as the names of what it keeps carry it. */
const stampNow = Effect.map(DateTime.now, (now) =>
  DateTime.formatIso(now)
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z"),
);

/** Set `id`'s database, into an empty database no Core holds, or one it replaces. */
export const restoreDatabase = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.scoped(
    Effect.gen(function* () {
      const query = yield* exclusive(target);
      const { dump } = yield* fetchSet(store, id, target.workDir);
      return yield* databaseFrom(dump, target, yield* stampNow, query);
    }),
  );

/** Set `id`'s repositories, into an empty git root, or one it replaces; no Core holds the database. */
export const restoreRepos = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* exclusive(target);
      const { manifest, bundles } = yield* fetchSet(store, id, target.workDir);
      const aside = yield* gitRootCleared(target, yield* stampNow);
      yield* reposFrom(manifest, bundles, target.gitRoot);
      return aside;
    }),
  );

/**
 * Set `id` whole: every file checked first, and a git root that must be empty found so before the
 * database is written; then the database, then the repositories. The set's manifest, and what the
 * restore kept of what it replaced.
 */
export const restoreSet = (store: BackupStore, id: string, target: RestoreTarget) =>
  Effect.scoped(
    Effect.gen(function* () {
      const query = yield* exclusive(target);
      const { manifest, dump, bundles } = yield* fetchSet(store, id, target.workDir);
      const stamp = yield* stampNow;
      if (target.replace !== true && (yield* reposIn(target.gitRoot)) > 0) {
        return yield* fail("target_not_empty", "the git root has repositories already");
      }
      const dumpKept = yield* databaseFrom(dump, target, stamp, query);
      const gitKept = yield* gitRootCleared(target, stamp);
      yield* reposFrom(manifest, bundles, target.gitRoot);
      const kept: Kept = { dump: dumpKept, git: gitKept };
      return { manifest, kept };
    }),
  );
