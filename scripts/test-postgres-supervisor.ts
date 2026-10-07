// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- standalone host-only test PostgreSQL supervisor.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import { lifecycleLock, postgresHome } from "./test-postgres.ts";

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
const data = NodePath.join(postgresHome, "data");
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
const urlOf = (port: number, name: string) => `postgres://postgres@127.0.0.1:${port}/${name}`;
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No PostgreSQL TCP address"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

async function guardPostgres() {
  if (!NodeFS.existsSync(data))
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
  const port = await freePort();
  NodeFS.writeFileSync(
    NodePath.join(data, "postgresql.auto.conf"),
    [
      `port = ${port}`,
      "listen_addresses = '127.0.0.1'",
      "unix_socket_directories = ''",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      "",
    ].join("\n"),
  );
  let running = false;
  run("pg_ctl", ["-D", data, "-l", NodePath.join(postgresHome, "postgres.log"), "-w", "start"]);
  running = true;
  const stop = () => {
    if (!running) return;
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
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
    // A prior supervisor's leases cannot survive its loss. Reclaim its managed databases on start.
    for (const name of sql("SELECT datname FROM pg_database WHERE datname LIKE 'mate_test_%'")
      .trim()
      .split("\n")
      .filter(Boolean)) {
      if (!/^mate_test_[a-f0-9]+$/u.test(name))
        throw new Error(`Unexpected test database: ${name}`);
      sql(`DROP DATABASE ${name} WITH (FORCE)`);
    }
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
    const server = NodeNet.createServer({ allowHalfOpen: true }, (socket) => {
      owners.add(socket);
      const databases = new Set<string>();
      const lines = NodeReadline.createInterface({ input: socket });
      lines.on("line", (command) => {
        try {
          if (released) return;
          if (command === "own") {
            socket.write(`${JSON.stringify({ url: "" })}\n`);
            return;
          }
          if (command === "release") {
            void release(true);
            return;
          }
          if (command !== "create")
            throw new Error(`Unknown PostgreSQL supervisor command: ${command}`);
          const name = `mate_test_${NodeCrypto.randomUUID().replaceAll("-", "")}`;
          databases.add(name);
          sql(`CREATE DATABASE ${name} TEMPLATE template0`);
          socket.write(`${JSON.stringify({ url: urlOf(port, name) })}\n`);
        } catch (error) {
          socket.write(`${JSON.stringify({ error: String(error) })}\n`);
        }
      });
      let released = false;
      const release = async (requested = false) => {
        if (released) return;
        released = true;
        lines.close();
        try {
          for (const name of databases) sql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
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
      socket.on("error", () => {
        void release();
      });
      socket.on("end", () => {
        void release();
      });
      socket.on("close", () => {
        void release();
      });
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
        if (!stopping) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
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
