// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- host-only test process supervisor protocol.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import { acquireProcessLock } from "./test-process-lock.ts";

/** Shared by worktrees, private to this OS user; independent of their module caches and ports. */
export const postgresHome = NodePath.join(
  "/tmp",
  `mate-test-pg-${process.getuid?.() ?? NodeOS.userInfo().username}`,
);
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

export interface TestPostgresLease {
  readonly createDatabase: () => Promise<string>;
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
        daemon!.once("message", (message) =>
          message === "ready"
            ? resolve()
            : reject(new Error(`PostgreSQL supervisor: ${String(message)}`)),
        );
        daemon!.once("exit", (code, signal) =>
          reject(
            new Error(
              `PostgreSQL supervisor exited: ${code ?? signal}\n${NodeFS.readFileSync(diagnosticsPath, "utf8")}`,
            ),
          ),
        );
      });
      const started = await connect();
      if (!started) throw new Error("PostgreSQL supervisor vanished after startup");
      socket = started;
    }
    opened = socket;
    const replies = NodeReadline.createInterface({ input: socket });
    const pending: { resolve: (url: string) => void; reject: (error: Error) => void }[] = [];
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
      const answer = JSON.parse(line) as { url?: string; error?: string };
      if (answer.error !== undefined) reply.reject(new Error(answer.error));
      else if (typeof answer.url === "string") reply.resolve(answer.url);
      else reply.reject(new Error("Invalid PostgreSQL supervisor reply"));
    });
    // Node must be allowed to exit even when a runner omits its layer finalizer.
    socket.unref();
    let closing: Promise<void> | undefined;
    const request = (command: string) => {
      if (failed) return Promise.reject(failed);
      socket.ref();
      return new Promise<string>((resolve, reject) => {
        pending.push({ resolve, reject });
        socket.write(`${command}\n`);
      }).finally(() => {
        if (pending.length === 0) socket.unref();
      });
    };
    // Transfer the bootstrap owner only after the supervisor acknowledges the live lease.
    await request("own");
    if (daemon?.connected) daemon.disconnect();
    daemon?.unref();
    return {
      createDatabase: () =>
        closing ? Promise.reject(new Error("PostgreSQL owner is released")) : request("create"),
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
