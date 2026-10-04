// @effect-diagnostics nodeBuiltinImport:off -- the harness runs the host's Postgres binaries in a temp directory.
/**
 * A throwaway Postgres cluster for the tests: `initdb` into a temp directory, a free TCP port, no
 * unix socket (macOS caps its path at 104 bytes), durability off. One cluster per test file
 * ({@link tempPostgresLayer}); every test takes a fresh database of it ({@link TempPostgres}).
 * Homebrew's binaries by default; `MATE_PG_BIN` moves them.
 *
 * @module test/harness/tempPostgres
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/**
 * Where the host's Postgres binaries are: `MATE_PG_BIN`, else `pg_config --bindir`, else the
 * newest Debian/Ubuntu cluster (`/usr/lib/postgresql/<major>/bin`, as on CI runners), else Homebrew.
 */
const pgBinDir = (() => {
  const named = process.env["MATE_PG_BIN"];
  if (named !== undefined) return named;
  const config = NodeChildProcess.spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const fromConfig = config.status === 0 ? config.stdout.trim() : "";
  if (fromConfig !== "" && NodeFS.existsSync(NodePath.join(fromConfig, "initdb")))
    return fromConfig;
  const debian = "/usr/lib/postgresql";
  if (NodeFS.existsSync(debian)) {
    const newest = NodeFS.readdirSync(debian)
      .filter((major) => NodeFS.existsSync(NodePath.join(debian, major, "bin", "initdb")))
      .sort((a, b) => Number(b) - Number(a))[0];
    if (newest !== undefined) return NodePath.join(debian, newest, "bin");
  }
  return "/opt/homebrew/bin";
})();

const pgBin = (name: string) => NodePath.join(pgBinDir, name);

interface Cluster {
  readonly root: string;
  readonly port: number;
}

const running = new Set<Cluster>();

const run = (command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });

const stop = (cluster: Cluster) => {
  run(pgBin("pg_ctl"), ["-D", NodePath.join(cluster.root, "data"), "-m", "fast", "-w", "stop"]);
  NodeFS.rmSync(cluster.root, { recursive: true, force: true });
  running.delete(cluster);
};

// A test run that dies still stops what it started.
process.once("exit", () => {
  for (const cluster of running) stop(cluster);
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const start = async (): Promise<Cluster> => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-pg-"));
  const data = NodePath.join(root, "data");
  const init = run(pgBin("initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "--no-sync",
    "--locale=C",
    "-E",
    "UTF8",
  ]);
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const cluster = { root, port: await freePort() };
  running.add(cluster);
  NodeFS.writeFileSync(
    NodePath.join(data, "postgresql.auto.conf"),
    [
      `port = ${String(cluster.port)}`,
      "listen_addresses = '127.0.0.1'",
      "unix_socket_directories = ''",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      "",
    ].join("\n"),
  );
  const started = run(pgBin("pg_ctl"), [
    "-D",
    data,
    "-l",
    NodePath.join(root, "log"),
    "-w",
    "start",
  ]);
  if (started.status !== 0) {
    stop(cluster);
    throw new Error(`pg_ctl start failed: ${started.stderr}`);
  }
  return cluster;
};

export class TempPostgres extends Context.Service<
  TempPostgres,
  {
    /** The connection string of a fresh, empty database of the cluster. */
    readonly createDatabase: Effect.Effect<string>;
    /** A database that refuses connections: the cluster's port with nothing listening behind it. */
    readonly deadUrl: Effect.Effect<string>;
  }
>()("@t3tools/hq/test/harness/tempPostgres") {}

const urlOf = (port: number, database: string) =>
  `postgres://postgres@127.0.0.1:${String(port)}/${database}`;

export const tempPostgresLayer = Layer.effect(
  TempPostgres,
  Effect.gen(function* () {
    const cluster = yield* Effect.acquireRelease(Effect.promise(start), (cluster) =>
      Effect.sync(() => stop(cluster)),
    );
    let databases = 0;
    const createDatabase = Effect.gen(function* () {
      databases += 1;
      const name = `t${String(databases)}`;
      const admin = yield* PgConnection.make({
        url: Redacted.make(urlOf(cluster.port, "postgres")),
      });
      yield* admin.query(`CREATE DATABASE ${name}`);
      return urlOf(cluster.port, name);
    }).pipe(Effect.scoped, Effect.orDie);
    return TempPostgres.of({
      createDatabase,
      deadUrl: Effect.promise(freePort).pipe(Effect.map((port) => urlOf(port, "postgres"))),
    });
  }),
);
