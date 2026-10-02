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
 *    the database's position (the event log's last `seq`, the first transaction not yet done). A set
 *    without its manifest is incomplete and never restored.
 *
 * A set is staged on the volume (`stagingDir/sets/<id>/`), uploaded to the store (`sets/<id>/…`, its
 * manifest last), and the newest complete one stays staged, laid out as the store keeps it: the
 * platform's own volume backup carries a set that restores as it is (`directoryStore(stagingDir)`).
 * With no store, backup is off and a set is only staged. The database's address reaches `pg_dump` in
 * libpq's own environment variables, never in its arguments, and no log carries it.
 *
 * No set is taken while the database stands where the newest set left it: that set is still whole.
 * A set is refused before it begins when `pg_dump` is older than the server: a dump it writes might
 * not restore. A set that fails leaves nothing of itself staged. `status` tells the newest set's
 * outcome, for `/health`.
 *
 * @module backup
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { GitError, HqGit } from "@t3tools/hq-git";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
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

const BundledRef = Schema.Struct({ ref: Schema.String, sha: Schema.String });

/** A set's manifest: what restores it, and what tells it is whole. */
export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  takenAt: Schema.String,
  /**
   * Where the database stood before the dump: the event log's last `seq`, and its snapshot's `xmax`,
   * the first transaction not yet done. Every write is a transaction, so an equal `xmax` is a
   * database nothing has written to since; what writes only to the log (a read pruning a page)
   * moves it not.
   */
  eventSeq: Schema.Number,
  xmax: Schema.String,
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
      refs: Schema.Array(BundledRef),
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
  /** Where sets are kept; none: backup off, a set only staged. */
  readonly store: BackupStore | null;
  /** The `pg_dump` this Core runs; the one on its path. */
  readonly pgDump?: string;
  /** For tests: what happens between the dump and the bundles. */
  readonly afterDump?: Effect.Effect<void>;
}

/** A set refused before it begins: a dump this `pg_dump` writes might not restore. */
export class PgDumpOlder extends Schema.TaggedError<PgDumpOlder>()("PgDumpOlder", {
  /** `pg_dump`'s major version, and the server's. */
  pgDump: Schema.Number,
  server: Schema.Number,
}) {}

type TakeError = BackupError | PgDumpOlder | GitError | NotLeader | SqlError;

type Position = Pick<Manifest, "eventSeq" | "xmax">;

/**
 * Backup as `/health` tells it, the newest set's outcome: `off` with no store, `pending` before a
 * first set, `ok` with the newest set kept, `failed` with why.
 */
export type BackupStatus =
  | { readonly state: "off" | "pending" }
  | { readonly state: "ok"; readonly set: string }
  | {
      readonly state: "failed";
      readonly reason: "pg_dump_older";
      readonly pgDump: number;
      readonly server: number;
    }
  | {
      readonly state: "failed";
      readonly reason: BackupError["reason"] | "git" | "not_leader" | "database" | "defect";
    };

const failedOf = (cause: Cause.Cause<TakeError>): BackupStatus => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  switch (error?._tag) {
    case "PgDumpOlder":
      return {
        state: "failed",
        reason: "pg_dump_older",
        pgDump: error.pgDump,
        server: error.server,
      };
    case "BackupError":
      return { state: "failed", reason: error.reason };
    case "GitError":
      return { state: "failed", reason: "git" };
    case "NotLeader":
      return { state: "failed", reason: "not_leader" };
    case "SqlError":
      return { state: "failed", reason: "database" };
    case undefined:
      return { state: "failed", reason: "defect" };
  }
};

export class Backup extends Context.Service<
  Backup,
  {
    /**
     * A set taken now, staged and kept in the store if there is one; its manifest. While the
     * database stands where the newest set left it, that set.
     */
    readonly take: Effect.Effect<Manifest, TakeError>;
    readonly status: Effect.Effect<BackupStatus>;
  }
>()("@t3tools/hq/backup") {}

/**
 * A set's id: when it was taken, to the millisecond, sortable as text. Two sets never share one:
 * a set that fails removes its own staging, which must not be a kept set's.
 */
const idOf = (takenAt: string) => takenAt.replace(/[-:]/gu, "");

export const backupLayer = (
  options: BackupOptions,
): Layer.Layer<Backup, never, SqlClient.SqlClient | GitHost> =>
  Layer.effect(
    Backup,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const pgDump = options.pgDump ?? "pg_dump";
      const status = yield* Ref.make<BackupStatus>(
        options.store === null ? { state: "off" } : { state: "pending" },
      );

      const staged = NodePath.join(options.stagingDir, "sets");

      /** Refused unless `pg_dump` is at least the server's major version: a dump that restores. */
      const restorable = Effect.gen(function* () {
        const answer = yield* runTool(pgDump, ["--version"], options.databaseUrl);
        const client = Number(/\(PostgreSQL\) (\d+)/u.exec(answer)?.[1] ?? Number.NaN);
        const [setting] = yield* sql<{ readonly version: string }>`
          SELECT current_setting('server_version_num') AS version`;
        const server = Math.floor(Number(setting?.version ?? Number.NaN) / 10_000);
        if (!Number.isInteger(client) || !Number.isInteger(server)) {
          return yield* failure("tool", `versions unreadable: ${answer.trim()}`);
        }
        if (client < server) return yield* new PgDumpOlder({ pgDump: client, server });
      });

      /** Where the database stands: the event log's last `seq` and the snapshot's `xmax`. */
      const positionNow = Effect.map(
        sql<{ readonly seq: string; readonly xmax: string }>`
          SELECT COALESCE((SELECT max(seq) FROM hq_git_event), 0)::text AS seq,
                 pg_snapshot_xmax(pg_current_snapshot())::text AS xmax`,
        ([row]): Position => ({ eventSeq: Number(row?.seq ?? 0), xmax: row?.xmax ?? "" }),
      );

      /** The newest staged set's manifest, if the set is whole and, with a store, kept there. */
      const newest = Effect.gen(function* () {
        const id = (yield* io("staged", () => NodeFSP.readdir(staged).catch(() => [])))
          .sort()
          .at(-1);
        if (id === undefined) return undefined;
        const manifest = yield* io("staged", () =>
          NodeFSP.readFile(NodePath.join(staged, id, "manifest.json"), "utf8"),
        ).pipe(Effect.flatMap(decodeManifest), Effect.option, Effect.map(Option.getOrUndefined));
        if (manifest === undefined || options.store === null) return manifest;
        const kept = yield* options.store.list(setKey(id, "manifest.json"));
        return kept.length > 0 ? manifest : undefined;
      });

      /** Set `id`, staged in `dir`: the dump, the bundles, then the manifest. */
      const stage = (git: HqGit, id: string, takenAt: string, dir: string, position: Position) =>
        Effect.gen(function* () {
          yield* io("stage", () => NodeFSP.mkdir(dir, { recursive: true }));
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
            ...position,
            database: {
              file: "db.dump",
              size: (yield* io("stat", () => NodeFSP.stat(dump))).size,
              sha256: yield* digestOf(dump),
            },
            repos,
          };
          yield* io("stage", () =>
            NodeFSP.writeFile(NodePath.join(dir, "manifest.json"), encodeManifest(manifest)),
          );
          return manifest;
        });

      /** The staged set into the store: its files, then the manifest that makes it whole. */
      const keep = (store: BackupStore, manifest: Manifest, dir: string) =>
        Effect.gen(function* () {
          const files = [
            manifest.database.file,
            ...manifest.repos.flatMap((repo) => (repo.file === null ? [] : [repo.file])),
            "manifest.json",
          ];
          for (const file of files) {
            yield* store.put(setKey(manifest.id, file), NodePath.join(dir, ...file.split("/")));
          }
        });

      const attempt = Effect.gen(function* () {
        const git = yield* gitHost.git;
        // While the database stands still, git has not moved either (every push is recorded), and
        // the newest set is still whole.
        const position = yield* positionNow;
        const last = yield* newest;
        if (last?.eventSeq === position.eventSeq && last.xmax === position.xmax) return last;
        yield* restorable;
        const takenAt = DateTime.formatIso(yield* DateTime.now);
        const id = idOf(takenAt);
        const dir = NodePath.join(staged, id);
        const store = options.store;
        // A set that fails leaves nothing of itself staged: the newest staged set stays whole.
        const manifest = yield* Effect.tap(stage(git, id, takenAt, dir, position), (manifest) =>
          store === null ? Effect.void : keep(store, manifest, dir),
        ).pipe(
          Effect.onError(() =>
            Effect.ignore(io("unstage", () => NodeFSP.rm(dir, { recursive: true, force: true }))),
          ),
        );
        // The newest complete set stays staged; the older go.
        for (const entry of yield* io("staged", () => NodeFSP.readdir(staged))) {
          if (entry !== id) {
            yield* io("unstage", () =>
              NodeFSP.rm(NodePath.join(staged, entry), { recursive: true, force: true }),
            );
          }
        }
        yield* Effect.logInfo(store === null ? "backup set staged" : "backup set kept", {
          id,
          repos: manifest.repos.length,
          bytes: manifest.database.size + manifest.repos.reduce((sum, repo) => sum + repo.size, 0),
        });
        return manifest;
      });

      const take = attempt.pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Ref.set(
                status,
                options.store === null ? { state: "off" } : { state: "ok", set: exit.value.id },
              )
            : Cause.hasInterruptsOnly(exit.cause)
              ? Effect.void
              : Effect.andThen(
                  Ref.set(status, failedOf(exit.cause)),
                  Effect.logError("backup set failed", exit.cause),
                ),
        ),
      );

      return Backup.of({ take, status: Ref.get(status) });
    }),
  );
