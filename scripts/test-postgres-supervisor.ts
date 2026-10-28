// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off globalTimers:off -- standalone host-only test PostgreSQL supervisor.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import {
  lifecycleLock,
  postgresBinDir,
  postgresHome,
  pruneStaleClusters,
  reclaimDeadRuns,
  startCluster,
  startRecord,
} from "./test-postgres.ts";
import { reservePort } from "./test-ports.ts";

const pgBinDir = postgresBinDir();
const data = NodePath.join(postgresHome, "data");
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const socketPath = NodePath.join(postgresHome, "supervisor.sock");
const run = (command: string, args: string[]) => {
  const result = NodeChildProcess.spawnSync(NodePath.join(pgBinDir, command), args, {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}${command === "pg_ctl" && NodeFS.existsSync(NodePath.join(postgresHome, "postgres.log")) ? NodeFS.readFileSync(NodePath.join(postgresHome, "postgres.log"), "utf8") : ""}`,
    );
  return result.stdout;
};
/** A clean stop removes the start record; any other end leaves it for the next start to rebuild. */
const stopPostgres = () => {
  run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  NodeFS.rmSync(startRecord(data), { force: true });
};
const urlOf = (port: number, name: string) => `postgres://postgres@127.0.0.1:${port}/${name}`;

const report = (line: string) => process.stderr.write(`${line}\n`);
const initialise = () =>
  run("initdb", [
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
const log = NodePath.join(postgresHome, "postgres.log");
const start = (port: number) => {
  // Each start reads only its own log; the last one stays beside it for forensics.
  if (NodeFS.existsSync(log)) NodeFS.renameSync(log, `${log}.previous`);
  NodeFS.writeFileSync(
    NodePath.join(data, "postgresql.auto.conf"),
    [
      `port = ${port}`,
      "listen_addresses = '127.0.0.1'",
      "unix_socket_directories = ''",
      "max_connections = 400",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      // Every checkout keeps its own cluster on the RAM disk; the 80 MB default WAL floor adds up.
      "min_wal_size = 32MB",
      "max_wal_size = 64MB",
      "",
    ].join("\n"),
  );
  run("pg_ctl", ["-D", data, "-l", log, "-w", "start"]);
  // A cluster that needed recovery crashed before; with fsync off its pages cannot be trusted.
  if (/PANIC:|automatic recovery in progress/u.test(NodeFS.readFileSync(log, "utf8"))) {
    run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    throw new Error(`PostgreSQL test cluster ${data} ran crash recovery`);
  }
};

async function guardPostgres() {
  // The guard holds the reservation until it ends, so no other test is handed PostgreSQL's port.
  const { port, release } = await reservePort();
  try {
    startCluster(data, { initialise, start: () => start(port), report });
    const postmaster = NodeFS.readFileSync(NodePath.join(data, "postmaster.pid"), "utf8");
    NodeFS.writeFileSync(startRecord(data), `${postmaster.split("\n")[0]}\n`);
  } catch (error) {
    // The held socket would keep a guard whose PostgreSQL never started alive.
    await release();
    throw error;
  }
  let running = true;
  const stop = () => {
    if (!running) return;
    stopPostgres();
    running = false;
  };
  process.once("exit", stop);
  const finish = () => {
    stop();
    process.exit(0);
  };
  process.stdin.resume();
  process.once("disconnect", finish);
  process.stdin.once("end", finish);
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
  process.send?.(port);
}

async function supervise() {
  pruneStaleClusters({ home: postgresHome, now: Date.now(), report });
  let bootstrapOwner = process.connected;
  let onIdle: (() => void) | undefined;
  process.once("disconnect", () => {
    bootstrapOwner = false;
    onIdle?.();
  });
  // The pipe guard owns pg_ctl. Even SIGKILL of this supervisor closes the pipe and stops PG.
  const guard = NodeChildProcess.spawn(
    "flock",
    [
      "-x",
      NodePath.join(postgresHome, "server.lock"),
      process.execPath,
      NodeURL.fileURLToPath(import.meta.url),
      "guard",
    ],
    { stdio: ["pipe", "ignore", "inherit", "ipc"] },
  );
  const exited = new Promise<void>((resolve, reject) => {
    guard.once("error", reject);
    guard.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`PostgreSQL guard exited: ${code ?? signal}`)),
    );
  });
  try {
    const port = await Promise.race([
      new Promise<number>((resolve, reject) =>
        guard.once("message", (message) =>
          typeof message === "number"
            ? resolve(message)
            : reject(new Error("Invalid PostgreSQL guard reply")),
        ),
      ),
      exited.then(() => {
        throw new Error("PostgreSQL guard exited before startup");
      }),
    ]);
    let stopping = false;
    const stop = async () => {
      stopping = true;
      guard.stdin!.end();
      await exited;
    };
    const sql = (query: string) =>
      run("psql", [urlOf(port, "postgres"), "-X", "-v", "ON_ERROR_STOP=1", "-Atc", query]);
    // Lease DDL runs off the event loop, so admission never waits behind another lease's DDL.
    const ddl = async (query: string) => {
      await execFile(
        NodePath.join(pgBinDir, "psql"),
        [urlOf(port, "postgres"), "-X", "-v", "ON_ERROR_STOP=1", "-Atc", query],
        { timeout: 60_000 },
      );
    };
    /**
     * Whether a database's last client backend left. A client's close returns before its backend
     * exits (PostgreSQL's own CREATE DATABASE … TEMPLATE waits for such backends too), so a closed
     * pool still shows for a moment; a connection held open is still there once the wait ends.
     * Autovacuum workers are no connections: they enter databases that refuse connections, may
     * outlast any bound on a busy host, and the clone's CREATE DATABASE stops them itself.
     */
    const drained = async (name: string) => {
      // Sample and decide on the server: a psql completion delayed on the host must not
      // turn a pre-exit activity snapshot into a rejection after the deadline.
      await execFile(NodePath.join(pgBinDir, "psql"), [
        urlOf(port, "postgres"),
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        `DO $$ DECLARE deadline timestamptz := clock_timestamp() + interval '2 seconds';
        BEGIN LOOP
          PERFORM pg_stat_clear_snapshot();
          IF NOT EXISTS (SELECT FROM pg_stat_activity
            WHERE datname = '${name}' AND backend_type = 'client backend') THEN
            RETURN;
          END IF;
          IF clock_timestamp() >= deadline THEN
            RAISE EXCEPTION 'Close database connections before freezing a template';
          END IF;
          PERFORM pg_sleep(0.025);
        END LOOP; END $$`,
      ]);
    };
    // A healed cluster has none; a reused one still holds what its killed runs left.
    reclaimDeadRuns(sql);
    const owners = new Set<NodeNet.Socket>();
    let shutdown: Promise<void> | undefined;
    const idle = (): Promise<void> => {
      if (owners.size || bootstrapOwner) return Promise.resolve();
      if (shutdown) return shutdown;
      shutdown = (async () => {
        const unlock = await lifecycleLock();
        try {
          if (owners.size || bootstrapOwner) return;
          // Released sockets can still await their cleanup reply. Stop accepting before stopping PG.
          server.close();
          await stop();
          NodeFS.rmSync(socketPath, { force: true });
        } finally {
          await unlock();
        }
      })().then(
        () => {
          shutdown = undefined;
          // Follow a canceled transition if its new owner also left before the lock was released.
          if (!stopping && !owners.size && !bootstrapOwner) return idle();
        },
        (error: unknown) => {
          shutdown = undefined;
          stopping = true;
          process.stderr.write(`${String(error)}\n`);
          process.exitCode = 1;
          throw error;
        },
      );
      return shutdown;
    };
    // Serialize database commands across leases rather than just pairing each lease's replies.
    let queue = Promise.resolve();
    const server = NodeNet.createServer({ allowHalfOpen: true }, (socket) => {
      owners.add(socket);
      const databases = new Set<string>();
      const templates = new Set<string>();
      const ownedDatabase = (url: string) => {
        const name = new URL(url).pathname.slice(1);
        if (!databases.has(name) || url !== urlOf(port, name))
          throw new Error("Database is not owned by this lease");
        return name;
      };
      const lines = NodeReadline.createInterface({ input: socket });
      lines.on("line", (command) => {
        // Acquirers hold lifecycle.lock until admission replies; idle shutdown needs that lock.
        // Keep admission outside the database queue so a last release cannot block its next owner.
        if (command === "own" || command === "capabilities") void answer(command);
        else queue = queue.then(() => answer(command));
      });
      const answer = async (command: string) => {
        try {
          if (released) return;
          if (command === "own") {
            socket.write(`${JSON.stringify({ url: "" })}\n`);
            return;
          }
          if (command === "capabilities") {
            socket.write(`${JSON.stringify({ capabilities: ["freeze", "clone"] })}\n`);
            return;
          }
          if (command === "release") {
            await release(true);
            return;
          }
          if (command.startsWith("freeze ")) {
            const name = ownedDatabase(command.slice("freeze ".length));
            // Publication requires a closed migration pool; no writer survives the freeze.
            await ddl(`ALTER DATABASE ${name} ALLOW_CONNECTIONS false`);
            try {
              await drained(name);
            } catch (error) {
              await ddl(`ALTER DATABASE ${name} ALLOW_CONNECTIONS true`);
              throw error;
            }
            templates.add(name);
            socket.write(`${JSON.stringify({ url: "" })}\n`);
            return;
          }
          let template = "template0";
          if (command.startsWith("clone ")) {
            template = ownedDatabase(command.slice("clone ".length));
            if (!templates.has(template))
              throw new Error("Database is not a frozen template owned by this lease");
          } else if (command !== "create") {
            throw new Error(`Unknown PostgreSQL supervisor command: ${command}`);
          }
          const name = `mate_test_${NodeCrypto.randomUUID().replaceAll("-", "")}`;
          databases.add(name);
          await ddl(`CREATE DATABASE ${name} TEMPLATE ${template}`);
          socket.write(`${JSON.stringify({ url: urlOf(port, name) })}\n`);
        } catch (error) {
          socket.write(`${JSON.stringify({ error: String(error) })}\n`);
        }
      };
      let released = false;
      const release = async (requested = false) => {
        if (released) return;
        released = true;
        lines.close();
        try {
          // Other workers still run here. Database drops wait for checkpoints, so reclaim them
          // only through reclaimDeadRuns at the next supervisor startup, before admitting tests.
          owners.delete(socket);
          await idle();
          if (requested) socket.write(`${JSON.stringify({ url: "" })}\n`);
        } catch (error) {
          if (requested) socket.write(`${JSON.stringify({ error: String(error) })}\n`);
          else process.stderr.write(`${String(error)}\n`);
          process.exitCode = 1;
          stopping = true;
          server.close();
          for (const owner of owners) if (owner !== socket) owner.destroy();
          guard.stdin!.end();
        }
        owners.delete(socket);
        socket.end();
      };
      const disconnected = () => {
        queue = queue.then(() => release());
      };
      socket.on("error", disconnected);
      socket.on("end", disconnected);
      socket.on("close", disconnected);
      // readline re-emits its socket's errors; one unheard would end every lease with the supervisor.
      lines.on("error", disconnected);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    onIdle = idle;
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        for (const owner of owners) owner.destroy();
        stopping = true;
        guard.stdin!.end();
      });
    exited
      .then(() => {
        if (stopping) return;
        for (const owner of owners) owner.destroy();
        server.close();
      })
      .catch((error: unknown) => {
        // The guard was our child. If it was killed, stop the server it started before failing.
        if (!stopping) stopPostgres();
        process.stderr.write(`${String(error)}\n`);
        process.exitCode = 1;
        for (const owner of owners) owner.destroy();
        server.close();
      });
    if (process.connected) process.send?.("ready");
    else idle();
  } catch (error) {
    guard.stdin!.end();
    await exited.catch(() => undefined);
    throw error;
  }
}

(process.argv[2] === "guard" ? guardPostgres() : supervise()).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
