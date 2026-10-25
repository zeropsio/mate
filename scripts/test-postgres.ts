// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off -- host-only test process supervisor protocol.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import { testRamdiskRoot } from "./lib/test-scratch-root.ts";
import { acquireProcessLock } from "./test-process-lock.ts";

/**
 * Shared by worktrees by default; MATE_TEST_PG_HOME isolates protocol testing from their leases.
 * macOS's periodic /tmp cleanup deletes files Postgres reads only at startup, so macOS keeps the
 * cluster in the user's cache directory (outside that cleanup and Time Machine). While the test
 * RAM disk is mounted the cluster lives there instead, off the indexed disk, at the home mate-hq's
 * tests share.
 */
export function choosePostgresHome(input: {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  readonly user: number | string;
  readonly ramdisk: string | undefined;
}): string {
  const named = input.env["MATE_TEST_PG_HOME"];
  if (named !== undefined) return named;
  if (input.ramdisk !== undefined)
    return NodePath.join(input.ramdisk, `mate-test-pg-${input.user}`);
  if (input.platform === "darwin")
    return NodePath.join(input.homeDirectory, "Library", "Caches", "mate-test-pg");
  return NodePath.join("/tmp", `mate-test-pg-${input.user}`);
}

export const postgresHome = choosePostgresHome({
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone test supervisor has no Effect runtime.
  platform: process.platform,
  env: process.env,
  homeDirectory: NodeOS.homedir(),
  user: process.getuid?.() ?? NodeOS.userInfo().username,
  ramdisk: testRamdiskRoot(),
});

/** The PostgreSQL server and client binaries the supervisor runs; tests reach its server with them. */
export function postgresBinDir(): string {
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
}

/**
 * The guard writes its postmaster's PID here once PostgreSQL starts and removes it once PostgreSQL
 * stops cleanly, so a record found at start means the last run crashed or was killed.
 */
export const startRecord = (data: string) =>
  NodePath.join(NodePath.dirname(data), "postmaster.started");

/** Whether `pid` is this user's `postgres -D <data>`; the command line confirms one PID, never selects. */
function runsCluster(pid: number, data: string): boolean {
  const shown = NodeChildProcess.spawnSync(
    "ps",
    ["-ww", "-o", "uid=,command=", "-p", String(pid)],
    {
      encoding: "utf8",
    },
  );
  if (shown.status !== 0) return false;
  const [uid, ...command] = shown.stdout.trim().split(/\s+/u);
  const server = command.findIndex(
    (token, index) => NodePath.basename(token) === "postgres" && command[index + 1] === "-D",
  );
  return (
    Number(uid) === process.getuid?.() &&
    server >= 0 &&
    command.slice(server + 2).join(" ") === data
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A postmaster whose supervisor died keeps postmaster.pid and wedges every later start. Only the
 * PID this cluster's guard recorded is stopped, and only while it still runs this data directory.
 * There is no exit notification for a non-child, so the wait is a bounded check of the PID.
 */
function stopRecordedPostmaster(pid: number, data: string, report: (line: string) => void) {
  if (!runsCluster(pid, data)) return;
  report(`PostgreSQL ${pid} outlived its supervisor on ${data}; stopping it with SIGQUIT.`);
  process.kill(pid, "SIGQUIT");
  const deadline = Date.now() + 10_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (alive(pid)) {
    if (Date.now() > deadline)
      throw new Error(`PostgreSQL ${pid} on ${data} did not exit within 10 s of SIGQUIT`);
    Atomics.wait(pause, 0, 0, 20);
  }
}

/**
 * The cluster is a cache, never data: with fsync and full_page_writes off a crashed cluster cannot
 * be trusted, so it is rebuilt rather than recovered. A data directory without PG_VERSION cannot
 * start either; both are replaced instead of failing in pg_ctl.
 */
export function prepareClusterDirectory(
  data: string,
  report: (line: string) => void,
): "reuse" | "initialise" {
  const record = startRecord(data);
  const recorded = NodeFS.existsSync(record);
  if (recorded) stopRecordedPostmaster(Number(NodeFS.readFileSync(record, "utf8")), data, report);
  const pidFile = NodePath.join(data, "postmaster.pid");
  const postmaster = NodeFS.existsSync(pidFile)
    ? Number(NodeFS.readFileSync(pidFile, "utf8").split("\n")[0])
    : undefined;
  if (postmaster !== undefined && alive(postmaster) && runsCluster(postmaster, data))
    throw new Error(
      `PostgreSQL ${postmaster} runs ${data}, but no supervisor recorded it; check that nothing uses it, stop it with kill -QUIT ${postmaster}, and run again.`,
    );
  if (recorded) {
    report(`PostgreSQL test cluster ${data} was not stopped cleanly; rebuilding it.`);
    NodeFS.rmSync(data, { recursive: true, force: true });
    NodeFS.rmSync(record, { force: true });
    return "initialise";
  }
  if (NodeFS.existsSync(NodePath.join(data, "PG_VERSION"))) return "reuse";
  if (NodeFS.existsSync(data)) {
    report(
      `PostgreSQL test cluster ${data} has no PG_VERSION (likely removed by temporary-file cleanup); re-initialising it.`,
    );
    NodeFS.rmSync(data, { recursive: true, force: true });
  }
  return "initialise";
}

const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Whether a postmaster still runs on `data`: the PID its postmaster.pid names is alive. */
function postmasterLive(data: string, alive: (pid: number) => boolean): boolean {
  let pidFile: string;
  try {
    pidFile = NodeFS.readFileSync(NodePath.join(data, "postmaster.pid"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const pid = Number(pidFile.split("\n")[0]);
  return Number.isInteger(pid) && pid > 0 && alive(pid);
}

/** The line of a failed start that names why: PostgreSQL's last PANIC or FATAL, else the error's first. */
function startFailure(error: unknown): string {
  const lines = String(error instanceof Error ? error.message : error).split("\n");
  return (lines.findLast((line) => /\b(?:PANIC|FATAL):/u.test(line)) ?? lines[0] ?? "").trim();
}

/**
 * Starts the test cluster in `data`, initialising it first when it has none. The cluster runs
 * without fsync, so a crash (a full disk) can leave WAL it can never replay. It is disposable test
 * data: a cluster that fails to start and leaves no postmaster behind is moved aside, removed and
 * initialised again at once. A fresh cluster that fails to start fails the run.
 */
export function startCluster(
  data: string,
  io: {
    readonly initialise: () => void;
    readonly start: () => void;
    readonly report: (line: string) => void;
    readonly alive?: (pid: number) => boolean;
  },
): void {
  if (prepareClusterDirectory(data, io.report) === "initialise") {
    io.initialise();
    io.start();
    return;
  }
  try {
    io.start();
    return;
  } catch (error) {
    if (postmasterLive(data, io.alive ?? processAlive)) throw error;
    const aside = `${data}.unstartable`;
    NodeFS.rmSync(aside, { recursive: true, force: true });
    NodeFS.renameSync(data, aside);
    io.report(
      `PostgreSQL test cluster ${data} could not start (${startFailure(error)}); moved it aside to ${aside}, removing it and re-initialising.`,
    );
    NodeFS.rmSync(aside, { recursive: true, force: true });
  }
  io.initialise();
  io.start();
}

/** initdb's own databases and roles (PostgreSQL's FirstNormalObjectId): everything above is a run's. */
const FIRST_RUN_OID = 16384;

/**
 * No lease survives the supervisor that granted it, so when one starts every database and role a
 * run made belongs to a dead run, whatever it is named: a killed lease's databases, one a run made
 * beside its lease, and roles named apart from any database. Drop them all; keep initdb's own.
 */
export function reclaimDeadRuns(sql: (query: string) => string): void {
  const made = (catalog: "pg_database" | "pg_roles", column: "datname" | "rolname") =>
    sql(`SELECT oid, quote_ident(${column}) FROM ${catalog}`)
      .split("\n")
      .filter(Boolean)
      .map((row) => row.split("|") as [string, string])
      .filter(([oid]) => Number(oid) >= FIRST_RUN_OID)
      .map(([, name]) => name);
  for (const name of made("pg_database", "datname")) sql(`DROP DATABASE ${name} WITH (FORCE)`);
  // A role still owning objects in `postgres` would refuse DROP ROLE alone.
  for (const name of made("pg_roles", "rolname")) sql(`DROP OWNED BY ${name}; DROP ROLE ${name}`);
}

/** A test cluster home unused this long is abandoned, whether or not its checkout still exists. */
export const STALE_CLUSTER_MS = 24 * 60 * 60 * 1000;

/**
 * Removes the test PostgreSQL homes beside `home` (named `mate-test-pg…` and owned by this user)
 * that no run has started, stopped or written for STALE_CLUSTER_MS and that hold no live
 * postmaster, so a killed or abandoned checkout's cluster is reclaimed by a later run.
 */
export function pruneStaleClusters(input: {
  readonly home: string;
  readonly now: number;
  readonly alive?: (pid: number) => boolean;
  readonly report: (line: string) => void;
}): void {
  const parent = NodePath.dirname(input.home);
  const uid = process.getuid?.();
  for (const name of NodeFS.readdirSync(parent)) {
    const other = NodePath.join(parent, name);
    if (!name.startsWith("mate-test-pg") || other === NodePath.resolve(input.home)) continue;
    const stat = NodeFS.statSync(other, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || (uid !== undefined && stat.uid !== uid)) continue;
    const lastUse = Math.max(
      stat.mtimeMs,
      ...NodeFS.readdirSync(other).map(
        (entry) =>
          NodeFS.statSync(NodePath.join(other, entry), { throwIfNoEntry: false })?.mtimeMs ?? 0,
      ),
    );
    if (input.now - lastUse < STALE_CLUSTER_MS) continue;
    if (postmasterLive(NodePath.join(other, "data"), input.alive ?? processAlive)) continue;
    NodeFS.rmSync(other, { recursive: true, force: true });
    input.report(
      `Removed test PostgreSQL home ${other}: unused for over 24 h and no postmaster runs on it.`,
    );
  }
}
const socketPath = NodePath.join(postgresHome, "supervisor.sock");

/** Serialize server election and idle shutdown, never test execution. The kernel releases on death. */
export async function lifecycleLock(): Promise<() => Promise<void>> {
  NodeFS.mkdirSync(postgresHome, { recursive: true, mode: 0o700 });
  return acquireProcessLock(NodePath.join(postgresHome, "lifecycle.lock"));
}

function connect(): Promise<NodeNet.Socket | undefined> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(socketPath);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve(undefined);
      else reject(error);
    });
  });
}

const mebibytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

/**
 * A full disk fails PostgreSQL, mkdtemp and vite's cache deep inside a run, and an ENOSPC crash
 * costs the cluster; refuse before a supervisor starts and say what fills the disk.
 */
function refuseFullDisk(home: string) {
  const floor = Number(process.env["MATE_TEST_PG_MIN_FREE_BYTES"] ?? 1024 ** 3);
  const disk = NodeFS.statfsSync(home);
  const free = disk.bavail * disk.bsize;
  if (free >= floor) return;
  const parent = NodePath.dirname(home);
  const sizes = NodeChildProcess.spawnSync(
    "du",
    ["-sk", ...NodeFS.readdirSync(parent).map((name) => NodePath.join(parent, name))],
    { encoding: "utf8" },
  );
  const largest = sizes.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kibibytes, ...path] = line.split("\t");
      return { name: NodePath.basename(path.join("\t")), bytes: Number(kibibytes) * 1024 };
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((entry) => `${entry.name} (${mebibytes(entry.bytes)})`);
  const volume = NodeChildProcess.spawnSync("df", ["-P", home], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .at(-1)!
    .split(/\s+/u)
    .at(-1)!;
  throw new Error(
    `The disk ${volume} holding the PostgreSQL test cluster is full: ${mebibytes(free)} free, below the ${mebibytes(floor)} a run needs. Largest under ${parent}: ${largest.join(", ")}.`,
  );
}

interface SupervisorReply {
  readonly url?: string;
  readonly capabilities?: ReadonlyArray<string>;
}

export interface TestPostgresLease {
  readonly supportsTemplates: boolean;
  readonly createDatabase: () => Promise<string>;
  readonly cloneDatabase: (templateUrl: string) => Promise<string>;
  /** Publish a closed, owned database as an immutable clone source. */
  readonly freezeDatabase: (url: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** The open connection is the owner: SIGKILL closes it too, without a heartbeat or PID guesses. */
export async function acquireTestPostgres(): Promise<TestPostgresLease> {
  const unlock = await lifecycleLock();
  let daemon: NodeChildProcess.ChildProcess | undefined;
  let socket: NodeNet.Socket;
  let opened: NodeNet.Socket | undefined;
  try {
    const existing = await connect();
    if (existing) socket = existing;
    else {
      refuseFullDisk(postgresHome);
      NodeFS.rmSync(socketPath, { force: true });
      const diagnosticsPath = NodePath.join(postgresHome, "supervisor.log");
      const diagnostics = NodeFS.openSync(diagnosticsPath, "w", 0o600);
      try {
        daemon = NodeChildProcess.spawn(
          process.execPath,
          [NodeURL.fileURLToPath(new URL("./test-postgres-supervisor.ts", import.meta.url))],
          { detached: true, stdio: ["ignore", "ignore", diagnostics, "ipc"] },
        );
      } finally {
        NodeFS.closeSync(diagnostics);
      }
      await new Promise<void>((resolve, reject) => {
        daemon!.once("error", reject);
        daemon!.once("message", (message) => {
          if (message !== "ready") {
            reject(new Error(`PostgreSQL supervisor: ${String(message)}`));
            return;
          }
          daemon!.off("exit", startupFailed);
          resolve();
        });
        const startupFailed = (code: number | null, signal: NodeJS.Signals | null) =>
          reject(
            new Error(
              `PostgreSQL supervisor exited: ${code ?? signal}\n${NodeFS.readFileSync(diagnosticsPath, "utf8")}`,
            ),
          );
        daemon!.once("exit", startupFailed);
      });
      const started = await connect();
      if (!started) throw new Error("PostgreSQL supervisor vanished after startup");
      socket = started;
    }
    opened = socket;
    const replies = NodeReadline.createInterface({ input: socket });
    const pending: { resolve: (reply: SupervisorReply) => void; reject: (error: Error) => void }[] =
      [];
    let failed: Error | undefined;
    const fail = (error: Error) => {
      failed = error;
      for (const reply of pending.splice(0)) reply.reject(error);
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("PostgreSQL supervisor connection closed")));
    replies.on("line", (line) => {
      const reply = pending.shift();
      if (!reply) {
        fail(new Error("Unexpected PostgreSQL supervisor reply"));
        return;
      }
      const answer = JSON.parse(line) as SupervisorReply & { error?: string };
      if (answer.error !== undefined) reply.reject(new Error(answer.error));
      else if (
        typeof answer.url === "string" ||
        (Array.isArray(answer.capabilities) &&
          answer.capabilities.every((value) => typeof value === "string"))
      )
        reply.resolve(answer);
      else reply.reject(new Error("Invalid PostgreSQL supervisor reply"));
    });
    // Node must be allowed to exit even when a runner omits its layer finalizer.
    socket.unref();
    let closing: Promise<void> | undefined;
    const request = (command: string) => {
      if (failed) return Promise.reject(failed);
      socket.ref();
      return new Promise<SupervisorReply>((resolve, reject) => {
        pending.push({ resolve, reject });
        socket.write(`${command}\n`);
      }).finally(() => {
        if (pending.length === 0) socket.unref();
      });
    };
    // Transfer the bootstrap owner only after the supervisor acknowledges the live lease.
    await request("own");
    const capabilities: ReadonlyArray<string> = await request("capabilities").then(
      (reply) => {
        if (!reply.capabilities) throw new Error("Invalid PostgreSQL supervisor capabilities");
        return reply.capabilities;
      },
      (error: unknown) => {
        if (
          error instanceof Error &&
          error.message === "Error: Unknown PostgreSQL supervisor command: capabilities"
        )
          return [];
        throw error;
      },
    );
    const database = (command: string) =>
      request(command).then((reply) => {
        if (typeof reply.url !== "string") throw new Error("Invalid PostgreSQL database reply");
        return reply.url;
      });
    if (daemon?.connected) daemon.disconnect();
    daemon?.unref();
    return {
      supportsTemplates: capabilities.includes("freeze") && capabilities.includes("clone"),
      createDatabase: () =>
        closing ? Promise.reject(new Error("PostgreSQL owner is released")) : database("create"),
      cloneDatabase: (templateUrl) =>
        closing
          ? Promise.reject(new Error("PostgreSQL owner is released"))
          : database(`clone ${templateUrl}`),
      freezeDatabase: (url) =>
        closing
          ? Promise.reject(new Error("PostgreSQL owner is released"))
          : request(`freeze ${url}`).then(() => undefined),
      close: () =>
        (closing ??= request("release").then(() => {
          replies.close();
          socket.end();
        })),
    };
  } catch (error) {
    opened?.destroy();
    throw error;
  } finally {
    if (daemon?.connected) daemon.disconnect();
    await unlock();
  }
}
