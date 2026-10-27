// @effect-diagnostics nodeBuiltinImport:off -- a set is files: pg_dump writes the dump, git the bundles, this the records.
/**
 * The one-shot backup (`main.mjs backup <dir>`), run only when an operator asks: a set as the hourly
 * backup writes it (`backup.ts`), plus `records/<table>.jsonl`, every table of the database with one
 * `to_jsonb` line per row, each named in the manifest's `records` with its rows, size and SHA-256.
 * That is the set the shared HQ's legacy import reads (zeropsio/mate-hq
 * `docs/operations/legacy-import.md`); `restore` reads it as any other set.
 *
 * It only reads. The records and the dump come from one read-only `REPEATABLE READ` transaction, the
 * dump through the snapshot that transaction exports, so both hold the same database. The bundles
 * are taken after it, as the hourly backup takes them, straight with git from the repositories as
 * the disk lists them: never through the git layer, whose opening sweeps what a running Core has in
 * flight. Sealed values are written as stored; nothing here opens them. A database restored from an
 * hourly `db.dump` serves as well as the live one, so a rehearsal touches no running HQ.
 *
 * @module oneShotBackup
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { GITHUB_REFS } from "@t3tools/hq-git";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  BackupError,
  Manifest,
  POSITION_QUERY,
  digestOf,
  idOf,
  io,
  pgDumpFits,
  positionOf,
  runTool,
} from "./backup.ts";

/** A one-shot set's manifest: the hourly one's, and each table's records. */
export const OneShotManifest = Schema.Struct({
  ...Manifest.fields,
  records: Schema.Array(
    Schema.Struct({
      table: Schema.String,
      rows: Schema.Number,
      file: Schema.String,
      size: Schema.Number,
      sha256: Schema.String,
    }),
  ),
});
export type OneShotManifest = typeof OneShotManifest.Type;

const encodeOneShotManifest = Schema.encodeSync(Schema.fromJsonString(OneShotManifest));

export interface OneShotOptions {
  readonly databaseUrl: Redacted.Redacted;
  /** Where the set is written: a directory that does not exist yet or is empty. */
  readonly dir: string;
  /** The git root whose repositories the set bundles: the volume's `/mnt/vol/git` in the container. */
  readonly gitRoot: string;
  /** The `pg_dump` to run; the one on the path. */
  readonly pgDump?: string;
}

const tool = (error: { readonly message: string }) =>
  new BackupError({ reason: "tool", message: error.message });

/** The git layer's repository and application ids; anything else under the root is its debris. */
const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id);

/** `git` in `dir`, reading no system or user configuration; its standard output. */
const git = (dir: string, args: ReadonlyArray<string>) =>
  io(
    `git ${args[0] ?? ""}`,
    () =>
      new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile(
          "git",
          [...args],
          {
            cwd: dir,
            env: {
              PATH: process.env["PATH"] ?? "/usr/bin:/bin",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
            },
            maxBuffer: 16 * 1024 * 1024,
          },
          (error, stdout, stderr) =>
            error === null ? resolve(stdout) : reject(new Error(stderr.trim() || error.message)),
        );
      }),
  );

/** Every repository of `root`, as the disk lists it. */
const reposIn = (root: string) =>
  io("git root", async () => {
    const repos: Array<{ readonly appId: string; readonly id: string }> = [];
    for (const app of (await NodeFSP.readdir(root, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!app.isDirectory() || !validId(app.name)) continue;
      for (const name of (await NodeFSP.readdir(NodePath.join(root, app.name))).toSorted()) {
        const id = name.replace(/\.git$/u, "");
        if (name.endsWith(".git") && validId(id)) repos.push({ appId: app.name, id });
      }
    }
    return repos;
  });

/**
 * The repository at `dir` as one bundle at `file`, as the git layer bundles it (`@t3tools/hq-git`
 * `bundle`): every ref but GitHub's. Its refs; none for a repository with no ref of its own, which
 * writes no bundle.
 */
const bundle = (dir: string, file: string) =>
  Effect.gen(function* () {
    const own = yield* git(dir, [
      "for-each-ref",
      "--count=1",
      "--format=%(refname)",
      `--exclude=${GITHUB_REFS}`,
    ]);
    if (own.trim() === "") return [];
    yield* git(dir, ["bundle", "create", "--quiet", file, `--exclude=${GITHUB_REFS}*`, "--all"]);
    return (yield* git(dir, ["bundle", "list-heads", file])).split("\n").flatMap((line) => {
      const [sha = "", ref = ""] = line.split(" ");
      return ref.startsWith("refs/") ? [{ ref, sha }] : [];
    });
  });

/** A file of the set: its size and SHA-256. */
const entryOf = (dir: string, file: string) =>
  Effect.gen(function* () {
    const path = NodePath.join(dir, ...file.split("/"));
    return {
      file,
      size: (yield* io("stat", () => NodeFSP.stat(path))).size,
      sha256: yield* digestOf(path),
    };
  });

/** The set written into `options.dir`; its manifest, written last. */
export const takeOneShotSet = (options: OneShotOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { dir, databaseUrl } = options;
      const pgDump = options.pgDump ?? "pg_dump";
      if ((yield* io("set", () => NodeFSP.readdir(dir).catch(() => []))).length > 0) {
        return yield* new BackupError({
          reason: "target_not_empty",
          message: `${dir} holds files already`,
        });
      }
      const repos = yield* reposIn(options.gitRoot);

      const connection = yield* PgConnection.make({ url: databaseUrl }).pipe(Effect.mapError(tool));
      const session = yield* connection.pin;
      const query = (statement: string) =>
        Effect.map(session.query(statement).pipe(Effect.mapError(tool)), (result) => result.rows);

      const [version] = yield* query("SELECT current_setting('server_version_num') AS version");
      yield* pgDumpFits(pgDump, databaseUrl, String(version?.["version"] ?? ""));

      yield* query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const [position] = yield* query(POSITION_QUERY);
      const [exported] = yield* query("SELECT pg_export_snapshot() AS snapshot");
      const takenAt = DateTime.formatIso(yield* DateTime.now);

      yield* io("set", () => NodeFSP.mkdir(NodePath.join(dir, "records"), { recursive: true }));
      yield* runTool(
        pgDump,
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--snapshot=${String(exported?.["snapshot"])}`,
          `--file=${NodePath.join(dir, "db.dump")}`,
        ],
        databaseUrl,
      );

      const tables = yield* query(
        "SELECT tablename, quote_ident(tablename) AS ident FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      );
      const records: Array<OneShotManifest["records"][number]> = [];
      for (const table of tables) {
        const file = `records/${String(table["tablename"])}.jsonl`;
        const rows = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* Effect.acquireRelease(
              io("records", () => NodeFSP.open(NodePath.join(dir, ...file.split("/")), "w")),
              (handle) => Effect.promise(() => handle.close()),
            );
            let count = 0;
            yield* session
              .stream(`SELECT to_jsonb(t)::text AS line FROM ${String(table["ident"])} t`)
              .pipe(
                Stream.mapError(tool),
                Stream.runForEachArray((batch) => {
                  count += batch.length;
                  return io("records", () =>
                    handle.write(batch.map((row) => `${String(row["line"])}\n`).join("")),
                  );
                }),
              );
            return count;
          }),
        );
        records.push({ table: String(table["tablename"]), rows, ...(yield* entryOf(dir, file)) });
      }
      yield* query("COMMIT");

      // Git after the database: it holds every commit the records name.
      const bundled: Array<Manifest["repos"][number]> = [];
      for (const repo of repos) {
        const file = `git/${repo.appId}/${repo.id}.bundle`;
        const path = NodePath.join(dir, ...file.split("/"));
        yield* io("set", () => NodeFSP.mkdir(NodePath.dirname(path), { recursive: true }));
        const refs = yield* bundle(
          NodePath.join(options.gitRoot, repo.appId, `${repo.id}.git`),
          path,
        );
        bundled.push(
          refs.length === 0
            ? { ...repo, file: null, size: 0, sha256: null, refs }
            : { ...repo, ...(yield* entryOf(dir, file)), refs },
        );
      }

      const manifest: OneShotManifest = {
        version: 1,
        id: idOf(takenAt),
        takenAt,
        ...positionOf(position),
        database: yield* entryOf(dir, "db.dump"),
        repos: bundled,
        records,
      };
      yield* io("set", () =>
        NodeFSP.writeFile(NodePath.join(dir, "manifest.json"), encodeOneShotManifest(manifest)),
      );
      return manifest;
    }),
  );
