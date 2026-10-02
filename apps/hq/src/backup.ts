// @effect-diagnostics nodeBuiltinImport:off -- a set is a directory of files: pg_dump writes one, git the others, the system digests them.
/**
 * HQ's backup (SPEC §3.2 `backup`, vysledky/hq-backup.md): a **set** is HQ's database and every
 * repository, consistent together. The leading Core writes it in order:
 *
 * 1. `db.dump`, `pg_dump --format=custom` of the database, one snapshot in pg_dump's own transaction;
 * 2. `git/<appId>/<repo>.bundle`, `git bundle --all` of each repository, taken after the dump. Git
 *    only moves forward (every repository denies deletions and non-fast-forwards and never prunes),
 *    so git holds every commit the dump names; what git holds beyond it a takeover records
 *    (`reconcile.ts`);
 * 3. `manifest.json` last: the set's files with their sizes and SHA-256, each repository's refs, and
 *    the database's position (the event log's last `seq`, the WAL position). A set without its
 *    manifest is incomplete and never restored.
 *
 * A set is staged on the volume (`stagingDir/<id>/`), uploaded to the store (`sets/<id>/…`, its
 * manifest last), and the newest complete one stays staged, so the platform's own volume backup
 * carries a restorable set too. The database's address reaches `pg_dump` in libpq's own environment
 * variables, never in its arguments, and no log carries it.
 *
 * @module backup
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { GitError } from "@t3tools/hq-git";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { GitHost } from "./gitHost.ts";
import type { NotLeader } from "./leader.ts";

export class BackupError extends Schema.TaggedError<BackupError>()("BackupError", {
  reason: Schema.Literals([
    "store",
    "tool",
    "manifest_missing",
    "manifest_unreadable",
    "digest_mismatch",
    "target_not_empty",
    "core_running",
  ]),
  message: Schema.String,
}) {}

const failure = (reason: BackupError["reason"], message: string) =>
  new BackupError({ reason, message });

/** One object of a store: its key and size in bytes. */
export interface StoredObject {
  readonly key: string;
  readonly size: number;
}

/** Where sets are kept: a bucket, or for tests a directory. */
export interface BackupStore {
  readonly put: (key: string, file: string) => Effect.Effect<void, BackupError>;
  readonly get: (key: string, file: string) => Effect.Effect<void, BackupError>;
  /** Every object whose key begins with `prefix`. */
  readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<StoredObject>, BackupError>;
  readonly remove: (key: string) => Effect.Effect<void, BackupError>;
}

const io = <A>(what: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      failure("store", `${what}: ${error instanceof Error ? error.message : String(error)}`),
  });

/** A store in a directory: each key a file under it. */
export const directoryStore = (dir: string): BackupStore => {
  const path = (key: string) => NodePath.join(dir, ...key.split("/"));
  const walk = async (at: string, prefix: string): Promise<Array<StoredObject>> => {
    const entries = await NodeFSP.readdir(at, { withFileTypes: true }).catch(() => []);
    const found: Array<StoredObject> = [];
    for (const entry of entries) {
      const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) found.push(...(await walk(NodePath.join(at, entry.name), key)));
      else found.push({ key, size: (await NodeFSP.stat(NodePath.join(at, entry.name))).size });
    }
    return found;
  };
  return {
    put: (key, file) =>
      io(`put ${key}`, async () => {
        await NodeFSP.mkdir(NodePath.dirname(path(key)), { recursive: true });
        await NodeFSP.copyFile(file, path(key));
      }),
    get: (key, file) =>
      io(`get ${key}`, async () => {
        await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
        await NodeFSP.copyFile(path(key), file);
      }),
    list: (prefix) =>
      io(`list ${prefix}`, async () =>
        (await walk(dir, "")).filter((object) => object.key.startsWith(prefix)),
      ),
    remove: (key) => io(`remove ${key}`, () => NodeFSP.rm(path(key), { force: true })),
  };
};

const Ref = Schema.Struct({ ref: Schema.String, sha: Schema.String });

/** A set's manifest: what restores it, and what tells it is whole. */
export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  takenAt: Schema.String,
  /** The event log's last `seq` and the WAL position, read before the dump. */
  eventSeq: Schema.Number,
  walLsn: Schema.String,
  database: Schema.Struct({
    file: Schema.String,
    size: Schema.Number,
    sha256: Schema.String,
  }),
  repos: Schema.Array(
    Schema.Struct({
      appId: Schema.String,
      id: Schema.String,
      /** None for a repository with no ref, which restores empty. */
      file: Schema.NullOr(Schema.String),
      size: Schema.Number,
      sha256: Schema.NullOr(Schema.String),
      refs: Schema.Array(Ref),
    }),
  ),
});
export type Manifest = typeof Manifest.Type;

export const encodeManifest = Schema.encodeSync(Schema.fromJsonString(Manifest));
export const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

/** The keys of a set's files in a store. */
export const setKey = (id: string, file: string) => `sets/${id}/${file}`;

/** A file's SHA-256, hex. */
export const digestOf = (file: string) =>
  io(
    `digest ${NodePath.basename(file)}`,
    () =>
      new Promise<string>((resolve, reject) => {
        const hash = NodeCrypto.createHash("sha256");
        NodeFS.createReadStream(file)
          .on("data", (chunk) => hash.update(chunk))
          .on("error", reject)
          .on("end", () => resolve(hash.digest("hex")));
      }),
  );

/**
 * The database's address as libpq reads it from its environment, so it never shows in a process's
 * arguments: host, port, user, password, database, and the TLS mode if the address names one.
 */
export const libpqEnv = (url: Redacted.Redacted): Record<string, string> => {
  const parsed = new URL(Redacted.value(url));
  const query = parsed.searchParams.get("sslmode");
  return {
    PGHOST: decodeURIComponent(parsed.hostname),
    PGPORT: parsed.port === "" ? "5432" : parsed.port,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//u, "")),
    ...(query === null ? {} : { PGSSLMODE: query }),
  };
};

/** A Postgres tool run with the database's address in its environment; its standard output. */
export const runTool = (command: string, args: ReadonlyArray<string>, url: Redacted.Redacted) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile(
          command,
          [...args],
          {
            env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...libpqEnv(url) },
            maxBuffer: 16 * 1024 * 1024,
          },
          (error, stdout, stderr) =>
            error === null
              ? resolve(stdout)
              : reject(new Error(`${NodePath.basename(command)} failed: ${stderr.trim()}`)),
        );
      }),
    // libpq names the host and the user in its errors, never the password; it is struck anyway.
    catch: (error) =>
      failure(
        "tool",
        String(error instanceof Error ? error.message : error).replaceAll(
          libpqEnv(url)["PGPASSWORD"] || "\u0000",
          "<redacted>",
        ),
      ),
  });

export interface BackupOptions {
  readonly databaseUrl: Redacted.Redacted;
  /** Where sets are staged before they upload: the volume's `/mnt/vol/backup` in the container. */
  readonly stagingDir: string;
  /** Where sets are kept; none: backup off. */
  readonly store: BackupStore | null;
  /** The `pg_dump` this Core runs; the one on its path. */
  readonly pgDump?: string;
  /** For tests: what happens between the dump and the bundles. */
  readonly afterDump?: Effect.Effect<void>;
}

export class Backup extends Context.Service<
  Backup,
  {
    /** A set taken now, staged and kept in the store; its manifest. */
    readonly take: Effect.Effect<Manifest, BackupError | GitError | NotLeader | SqlError>;
  }
>()("@t3tools/hq/backup") {}

/** A set's id: when it was taken, to the second, sortable as text. */
const idOf = (takenAt: string) => takenAt.replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");

export const backupLayer = (
  options: BackupOptions,
): Layer.Layer<Backup, never, SqlClient.SqlClient | GitHost> =>
  Layer.effect(
    Backup,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const pgDump = options.pgDump ?? "pg_dump";

      const take = Effect.gen(function* () {
        const store = options.store;
        if (store === null) return yield* failure("store", "backup is off: no store");
        const git = yield* gitHost.git;
        const takenAt = DateTime.formatIso(yield* DateTime.now);
        const id = idOf(takenAt);
        const dir = NodePath.join(options.stagingDir, id);
        yield* io("stage", () => NodeFSP.mkdir(dir, { recursive: true }));
        const [position] = yield* sql<{ readonly seq: string; readonly lsn: string }>`
          SELECT COALESCE((SELECT max(seq) FROM hq_git_event), 0)::text AS seq,
                 pg_current_wal_lsn()::text AS lsn`;
        // The database first: git taken after it holds every commit it names.
        const dump = NodePath.join(dir, "db.dump");
        yield* runTool(
          pgDump,
          ["--format=custom", "--no-owner", "--no-acl", `--file=${dump}`],
          options.databaseUrl,
        );
        if (options.afterDump !== undefined) yield* options.afterDump;
        const repos: Array<Manifest["repos"][number]> = [];
        for (const repo of yield* git.list()) {
          const file = `git/${repo.appId}/${repo.id}.bundle`;
          const path = NodePath.join(dir, ...file.split("/"));
          yield* io("stage", () => NodeFSP.mkdir(NodePath.dirname(path), { recursive: true }));
          const { refs } = yield* git.bundle(repo, path);
          repos.push(
            refs.length === 0
              ? { appId: repo.appId, id: repo.id, file: null, size: 0, sha256: null, refs }
              : {
                  appId: repo.appId,
                  id: repo.id,
                  file,
                  size: (yield* io("stat", () => NodeFSP.stat(path))).size,
                  sha256: yield* digestOf(path),
                  refs,
                },
          );
        }
        const manifest: Manifest = {
          version: 1,
          id,
          takenAt,
          eventSeq: Number(position?.seq ?? 0),
          walLsn: position?.lsn ?? "",
          database: {
            file: "db.dump",
            size: (yield* io("stat", () => NodeFSP.stat(dump))).size,
            sha256: yield* digestOf(dump),
          },
          repos,
        };
        const manifestPath = NodePath.join(dir, "manifest.json");
        yield* io("stage", () => NodeFSP.writeFile(manifestPath, encodeManifest(manifest)));
        // The files, then the manifest that makes the set whole.
        yield* store.put(setKey(id, "db.dump"), dump);
        for (const repo of repos) {
          if (repo.file !== null) {
            yield* store.put(setKey(id, repo.file), NodePath.join(dir, ...repo.file.split("/")));
          }
        }
        yield* store.put(setKey(id, "manifest.json"), manifestPath);
        // The newest complete set stays staged; the older go.
        for (const entry of yield* io("staged", () => NodeFSP.readdir(options.stagingDir))) {
          if (entry !== id) {
            yield* io("unstage", () =>
              NodeFSP.rm(NodePath.join(options.stagingDir, entry), {
                recursive: true,
                force: true,
              }),
            );
          }
        }
        yield* Effect.logInfo("backup set kept", {
          id,
          repos: repos.length,
          bytes: manifest.database.size + repos.reduce((sum, repo) => sum + repo.size, 0),
        });
        return manifest;
      });

      return Backup.of({ take });
    }),
  );
