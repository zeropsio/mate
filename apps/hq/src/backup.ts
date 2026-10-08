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
 * libpq's own environment variables, never in its arguments, and no log carries it. A set carries
 * every environment's deploy token only sealed, and never the key that opens it: `HQ_KEY_SECRET`
 * lives in HQ's env (`deployKeys.ts`), so a set restored onto an HQ with another key deploys
 * nothing with them.
 *
 * The leading Core takes a set on its own `every` after the newest staged one, at once when none
 * is staged; one set at a time. No set is taken while the database stands where the newest set
 * left it: that set is still whole.
 * A set is refused before it begins when `pg_dump` is older than the server: a dump it writes might
 * not restore. A set that fails leaves nothing of itself staged. `status` tells the newest set's
 * outcome, for `/health`.
 *
 * The store keeps what the retention targets keep (`retained`): the newest set of each hour for a
 * day, of each day for 14 days, of each month for 6 months. Before a set uploads, it makes its room
 * under 90% of the store's quota (`roomFor`): when that costs a set the targets keep, backup is
 * `degraded`; when nothing makes it, the set is refused and the kept sets stay.
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
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

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

/** A promise run for a store or the staging: its failure a store's. */
export const io = <A>(what: string, run: () => Promise<A>) =>
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
    // As in a bucket, a key's folders are there only while a key is under them.
    remove: (key) =>
      io(`remove ${key}`, async () => {
        await NodeFSP.rm(path(key), { force: true });
        for (let at = NodePath.dirname(path(key)); at !== dir; at = NodePath.dirname(at)) {
          if ((await NodeFSP.readdir(at).catch(() => [""])).length > 0) break;
          await NodeFSP.rmdir(at);
        }
      }),
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
  /** The store's quota, in GB (`HQ_BACKUP_QUOTA_GB`); none: no limit. */
  readonly quotaGb?: number;
  /** The `pg_dump` this Core runs; the one on its path. */
  readonly pgDump?: string;
  /** For tests: what happens between the dump and the bundles. */
  readonly afterDump?: Effect.Effect<void>;
  /**
   * How long after the newest set the next is due, taken by the leading Core on its own; none: a
   * set only when `take` is asked.
   */
  readonly every?: Duration.Duration;
  /** How often the leading Core looks whether a set is due; a minute. */
  readonly checkEvery?: Duration.Duration;
}

/** A set refused before it begins: a dump this `pg_dump` writes might not restore. */
export class PgDumpOlder extends Schema.TaggedError<PgDumpOlder>()("PgDumpOlder", {
  /** `pg_dump`'s major version, and the server's. */
  pgDump: Schema.Number,
  server: Schema.Number,
}) {}

/**
 * A set that cannot take a repository git quarantined (`gitHost.ts`): `repo` (`<appId>/<repo>`), and
 * why it is withheld. Without it the set would lack what its dump names.
 */
export class RepoQuarantined extends Schema.TaggedError<RepoQuarantined>()("RepoQuarantined", {
  repo: Schema.String,
  why: Schema.String,
}) {}

/** A set refused for want of room: the store holds `used` bytes it may not lose, the set `needed`. */
export class BucketFull extends Schema.TaggedError<BucketFull>()("BucketFull", {
  used: Schema.Number,
  needed: Schema.Number,
  quota: Schema.Number,
}) {}

/**
 * Refused unless `pgDump` is at least the major version of the server, whose `server_version_num`
 * is `serverVersionNum`: a dump it writes then restores.
 */
export const pgDumpFits = (pgDump: string, url: Redacted.Redacted, serverVersionNum: string) =>
  Effect.gen(function* () {
    const answer = yield* runTool(pgDump, ["--version"], url);
    const client = Number(/\(PostgreSQL\) (\d+)/u.exec(answer)?.[1] ?? Number.NaN);
    const server = Math.floor(Number(serverVersionNum || Number.NaN) / 10_000);
    if (!Number.isInteger(client) || !Number.isInteger(server)) {
      return yield* failure("tool", `versions unreadable: ${answer.trim()}`);
    }
    if (client < server) return yield* new PgDumpOlder({ pgDump: client, server });
  });

type TakeError =
  | BackupError
  | PgDumpOlder
  | BucketFull
  | RepoQuarantined
  | GitError
  | NotLeader
  | SqlError;

/** The store's bytes after a set's room was made, the set's own, and the quota. */
interface Usage {
  readonly usedBytes: number;
  readonly neededBytes: number;
  readonly quotaBytes: number;
}

type Position = Pick<Manifest, "eventSeq" | "xmax">;

/**
 * Backup as `/health` tells it, the newest set's outcome: `off` with no store, `pending` before a
 * first set (on a volume with none staged), `ok` with the newest set kept, `degraded` when a set the retention targets keep went to
 * make its room, `failed` with why.
 */
export type BackupStatus =
  | { readonly state: "off" | "pending" }
  | { readonly state: "ok"; readonly set: string }
  | ({ readonly state: "degraded"; readonly set: string } & Usage)
  | ({ readonly state: "failed"; readonly reason: "quota" } & Usage)
  | {
      readonly state: "failed";
      readonly reason: "pg_dump_older";
      readonly pgDump: number;
      readonly server: number;
    }
  | { readonly state: "failed"; readonly reason: "repo_quarantined"; readonly repo: string }
  | {
      readonly state: "failed";
      readonly reason: BackupError["reason"] | "git" | "database" | "defect";
    };

/** The status a set failed with, by its error; none: a defect. */
const failedOf = (error: Exclude<TakeError, NotLeader> | undefined): BackupStatus => {
  switch (error?._tag) {
    case "PgDumpOlder":
      return {
        state: "failed",
        reason: "pg_dump_older",
        pgDump: error.pgDump,
        server: error.server,
      };
    case "BucketFull":
      return {
        state: "failed",
        reason: "quota",
        usedBytes: error.used,
        neededBytes: error.needed,
        quotaBytes: error.quota,
      };
    case "BackupError":
      return { state: "failed", reason: error.reason };
    case "RepoQuarantined":
      return { state: "failed", reason: "repo_quarantined", repo: error.repo };
    case "GitError":
      return { state: "failed", reason: "git" };
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

/** How long each target keeps sets, and the part of an id that names its hour, day, month. */
const TARGETS: ReadonlyArray<{
  readonly within: Partial<DateTime.DateTime.PartsForMath>;
  readonly slot: number;
}> = [
  { within: { hours: 24 }, slot: "YYYYMMDDTHH".length },
  { within: { days: 14 }, slot: "YYYYMMDD".length },
  { within: { months: 6 }, slot: "YYYYMM".length },
];

/**
 * The sets the retention targets keep, of `ids` at `now`: the newest of each hour for 24 hours, of
 * each day for 14 days, of each month for 6 months; and the newest of all, whenever it was taken.
 */
export const retained = (ids: ReadonlyArray<string>, now: DateTime.Utc): ReadonlySet<string> => {
  const newestFirst = [...ids].sort((a, b) => (a < b ? 1 : -1));
  const kept = new Set(newestFirst.slice(0, 1));
  for (const { within, slot } of TARGETS) {
    const since = idOf(DateTime.formatIso(DateTime.subtract(now, within)));
    const slots = new Set<string>();
    for (const id of newestFirst) {
      if (id >= since && !slots.has(id.slice(0, slot))) {
        slots.add(id.slice(0, slot));
        kept.add(id);
      }
    }
  }
  return kept;
};

/** A set in the store: whole when its manifest is there. */
export interface StoredSet {
  readonly id: string;
  readonly bytes: number;
  readonly whole: boolean;
}

/** A store's objects by the set they belong to (`sets/<id>/…`). */
const bySet = (objects: ReadonlyArray<StoredObject>) => {
  const found = new Map<string, Array<StoredObject>>();
  for (const object of objects) {
    const id = object.key.split("/")[1] ?? "";
    found.set(id, [...(found.get(id) ?? []), object]);
  }
  return found;
};

/** A store's sets, oldest first: each with its bytes, whole when its manifest is there. */
export const setsIn = (objects: ReadonlyArray<StoredObject>): ReadonlyArray<StoredSet> =>
  [...bySet(objects)]
    .map(([id, files]) => ({
      id,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      whole: files.some((file) => file.key === setKey(id, "manifest.json")),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

/** What a new set's room costs: the sets to remove, and the bytes the store holds after. */
export interface Room {
  readonly remove: ReadonlyArray<string>;
  /** Whether the new set fits under the limit then. */
  readonly fits: boolean;
  /** Whether a set the retention targets keep goes to make the room. */
  readonly cut: boolean;
  readonly used: number;
}

/**
 * The room for `incoming` in a store holding `stored`, under `limit` bytes. The incomplete sets and
 * those no target keeps go anyway. While the new set would not fit, the kept go too, oldest first,
 * never the newest whole one (it is all there is until the new one is whole). When nothing makes the
 * room, no kept set goes for a set that will not be kept.
 */
export const roomFor = (
  stored: ReadonlyArray<StoredSet>,
  incoming: { readonly id: string; readonly bytes: number },
  limit: number,
  now: DateTime.Utc,
): Room => {
  const oldestFirst = [...stored].sort((a, b) => (a.id < b.id ? -1 : 1));
  const whole = oldestFirst.filter((set) => set.whole).map((set) => set.id);
  const total = stored.reduce((sum, set) => sum + set.bytes, 0);
  const goingAnyway = (kept: ReadonlySet<string>) => [
    ...oldestFirst.filter((set) => !set.whole),
    ...oldestFirst.filter((set) => set.whole && !kept.has(set.id)),
  ];
  const kept = retained([...whole, incoming.id], now);
  const gone = goingAnyway(kept);
  let used = total - gone.reduce((sum, set) => sum + set.bytes, 0);
  const cut: Array<StoredSet> = [];
  for (const set of oldestFirst) {
    if (used + incoming.bytes <= limit) break;
    if (set.whole && kept.has(set.id) && set.id !== whole.at(-1)) {
      cut.push(set);
      used -= set.bytes;
    }
  }
  if (used + incoming.bytes <= limit) {
    return {
      remove: [...gone, ...cut].map((set) => set.id),
      fits: true,
      cut: cut.length > 0,
      used,
    };
  }
  const stays = goingAnyway(retained(whole, now));
  return {
    remove: stays.map((set) => set.id),
    fits: false,
    cut: false,
    used: total - stays.reduce((sum, set) => sum + set.bytes, 0),
  };
};

export const backupLayer = (
  options: BackupOptions,
): Layer.Layer<Backup, never, SqlClient.SqlClient | GitHost> =>
  Layer.effect(
    Backup,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const pgDump = options.pgDump ?? "pg_dump";
      const staged = NodePath.join(options.stagingDir, "sets");

      /** Refused unless `pg_dump` is at least the server's major version: a dump that restores. */
      const restorable = Effect.flatMap(
        sql<{ readonly version: string }>`
          SELECT current_setting('server_version_num') AS version`,
        ([setting]) => pgDumpFits(pgDump, options.databaseUrl, setting?.version ?? ""),
      );

      /** Where the database stands: the event log's last `seq` and the snapshot's `xmax`. */
      const positionNow = Effect.map(
        sql<{ readonly seq: string; readonly xmax: string }>`
          SELECT COALESCE((SELECT max(seq) FROM hq_git_event), 0)::text AS seq,
                 pg_snapshot_xmax(pg_current_snapshot())::text AS xmax`,
        ([row]): Position => ({ eventSeq: Number(row?.seq ?? 0), xmax: row?.xmax ?? "" }),
      );

      /** The newest staged set's manifest, if the set is whole. */
      const newestStaged = Effect.gen(function* () {
        const id = (yield* io("staged", () => NodeFSP.readdir(staged).catch(() => [])))
          .sort()
          .at(-1);
        if (id === undefined) return undefined;
        return yield* io("staged", () =>
          NodeFSP.readFile(NodePath.join(staged, id, "manifest.json"), "utf8"),
        ).pipe(Effect.flatMap(decodeManifest), Effect.option, Effect.map(Option.getOrUndefined));
      });

      // Before a set is taken, the newest staged one: a deploy leaves it on the volume.
      const stagedAtStart = yield* Effect.orElseSucceed(newestStaged, () => undefined);
      const status = yield* Ref.make<BackupStatus>(
        options.store === null
          ? { state: "off" }
          : stagedAtStart === undefined
            ? { state: "pending" }
            : { state: "ok", set: stagedAtStart.id },
      );

      /** The newest staged set's manifest, if the set is whole and, with a store, kept there. */
      const newest = Effect.gen(function* () {
        const manifest = yield* newestStaged;
        if (manifest === undefined || options.store === null) return manifest;
        const kept = yield* options.store.list(setKey(manifest.id, "manifest.json"));
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
            const { refs } = yield* git.bundle(repo, path).pipe(
              Effect.catchIf(
                (error) => error.reason === "unavailable",
                (error) =>
                  Effect.fail(
                    new RepoQuarantined({ repo: `${repo.appId}/${repo.id}`, why: error.message }),
                  ),
              ),
            );
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

      /**
       * Room in the store for the staged set (`roomFor`), under 90% of the quota; refused when
       * nothing makes it. When a set the targets keep went for it, the store's usage.
       */
      const makeRoom = (store: BackupStore, manifest: Manifest, dir: string, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const listed = yield* store.list("sets/");
          const objects = bySet(listed);
          const stored = setsIn(listed);
          const needed =
            manifest.database.size +
            manifest.repos.reduce((sum, repo) => sum + repo.size, 0) +
            (yield* io("stat", () => NodeFSP.stat(NodePath.join(dir, "manifest.json")))).size;
          const quota =
            options.quotaGb === undefined ? Number.POSITIVE_INFINITY : options.quotaGb * 1e9;
          const room = roomFor(stored, { id: manifest.id, bytes: needed }, quota * 0.9, now);
          for (const id of room.remove) {
            // Its manifest first: a set half removed is incomplete, never whole with files missing.
            const files = [...(objects.get(id) ?? [])].sort(
              (a, b) =>
                Number(b.key === setKey(id, "manifest.json")) -
                Number(a.key === setKey(id, "manifest.json")),
            );
            for (const file of files) yield* store.remove(file.key);
          }
          if (!room.fits) {
            return yield* new BucketFull({ used: room.used, needed, quota: Math.round(quota) });
          }
          return room.cut
            ? { usedBytes: room.used, neededBytes: needed, quotaBytes: Math.round(quota) }
            : undefined;
        });

      const attempt = Effect.gen(function* () {
        const git = yield* gitHost.git;
        // While the database stands still, git has not moved either (every push is recorded), and
        // the newest set is still whole.
        const position = yield* positionNow;
        const last = yield* newest;
        if (last?.eventSeq === position.eventSeq && last.xmax === position.xmax) {
          return { manifest: last, cut: undefined };
        }
        yield* restorable;
        const now = yield* DateTime.now;
        const takenAt = DateTime.formatIso(now);
        const id = idOf(takenAt);
        const dir = NodePath.join(staged, id);
        const store = options.store;
        // A set that fails leaves nothing of itself staged: the newest staged set stays whole.
        const { manifest, cut } = yield* Effect.flatMap(
          // No repository goes while the set takes them (`gitHost.ts` `holdingRepos`).
          gitHost.holdingRepos(stage(git, id, takenAt, dir, position)),
          (manifest) =>
            store === null
              ? Effect.succeed({ manifest, cut: undefined })
              : Effect.gen(function* () {
                  const cut = yield* makeRoom(store, manifest, dir, now);
                  yield* keep(store, manifest, dir);
                  return { manifest, cut };
                }),
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
          ...cut,
        });
        return { manifest, cut };
      });

      // One set at a time: the second asked for waits, and finds the first.
      const one = yield* Semaphore.make(1);
      const take = attempt.pipe(
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) {
            return Ref.set(
              status,
              options.store === null
                ? { state: "off" }
                : exit.value.cut === undefined
                  ? { state: "ok", set: exit.value.manifest.id }
                  : { state: "degraded", set: exit.value.manifest.id, ...exit.value.cut },
            );
          }
          const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          // Nor a Core that does not lead, nor one interrupted, tells of a set.
          if (Cause.hasInterruptsOnly(exit.cause) || error?._tag === "NotLeader")
            return Effect.void;
          return Effect.andThen(
            Ref.set(status, failedOf(error)),
            Effect.logError("backup set failed", exit.cause),
          );
        }),
        Effect.map(({ manifest }) => manifest),
        one.withPermits(1),
      );

      if (options.every !== undefined) {
        const every = Duration.toMillis(options.every);
        // Due `every` after the newest staged set, which a deploy leaves on the volume; with none,
        // at once. A Core that does not lead (`take` fails at once) looks again at the next check.
        const due = yield* Ref.make<number | undefined>(undefined);
        const dueAfterNewest = Effect.map(newestStaged, (manifest) =>
          manifest === undefined
            ? 0
            : Option.match(DateTime.make(manifest.takenAt), {
                onNone: () => 0,
                onSome: (takenAt) => DateTime.toEpochMillis(takenAt) + every,
              }),
        );
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.andThen(
              Effect.sleep(options.checkEvery ?? Duration.minutes(1)),
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;
                const at = (yield* Ref.get(due)) ?? (yield* dueAfterNewest);
                if (now < at) return yield* Ref.set(due, at);
                const taken = yield* Effect.exit(take);
                if (
                  Exit.isFailure(taken) &&
                  Option.getOrUndefined(Cause.findErrorOption(taken.cause))?._tag === "NotLeader"
                ) {
                  return;
                }
                yield* Ref.set(due, now + every);
              }).pipe(Effect.catch((error) => Effect.logWarning("backup check failed", error))),
            ),
          ),
        );
      }

      return Backup.of({ take, status: Ref.get(status) });
    }),
  );
