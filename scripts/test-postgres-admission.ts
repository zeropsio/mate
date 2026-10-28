// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- host-only test PostgreSQL admission.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";
import { acquireProcessLock } from "./test-process-lock.ts";

/** Leave one host core for PostgreSQL and the supervising runner. */
export const postgresAdmissionBudget = (cores = NodeOS.availableParallelism()) =>
  Math.max(1, cores - 1);

interface AdmissionOptions {
  readonly directory?: string;
  readonly capacity?: number;
  readonly signal?: AbortSignal;
  readonly onLost?: (error: Error) => void;
  readonly onWaiting?: () => void;
}

const defaultDirectory = () =>
  NodePath.join(NodeOS.homedir(), ".local", "share", "mate-test-pg-admission");
const socketFile = (directory: string) => NodePath.join(directory, "host.sock");
const electionFile = (directory: string) => NodePath.join(directory, "election.lock");
const generationFile = (directory: string) => NodePath.join(directory, "generation.lock");

function connect(directory: string): Promise<NodeNet.Socket | undefined> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(socketFile(directory));
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

/** One socket is one unit of host work; EOF is also the process-exit release receipt. */
export async function acquirePostgresAdmission(
  options: AdmissionOptions = {},
): Promise<{ release: () => Promise<void> }> {
  options.signal?.throwIfAborted();
  const directory = options.directory ?? defaultDirectory();
  const capacity = options.capacity ?? postgresAdmissionBudget();
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error("PostgreSQL admission capacity must be a positive integer");
  NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const unlock = await acquireProcessLock(
    electionFile(directory),
    options.signal ? { signal: options.signal } : {},
  );
  let daemon: NodeChildProcess.ChildProcess | undefined;
  let socket: NodeNet.Socket | undefined;
  let lines: NodeReadline.Interface | undefined;
  const inbox: string[] = [];
  let next: { resolve: (line: string) => void; reject: (error: Error) => void } | undefined;
  let failure: Error | undefined;
  let owned = false;
  let released = false;
  let unlockGeneration: (() => Promise<void>) | undefined;
  const receive = () => {
    const line = inbox.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (failure) return Promise.reject(failure);
    return new Promise<string>((resolve, reject) => {
      next = { resolve, reject };
    });
  };
  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    next?.reject(error);
    next = undefined;
    if (owned && !released) options.onLost?.(error);
  };
  let cancelStartup: ((error: Error) => void) | undefined;
  const abort = () => {
    const error =
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("PostgreSQL admission cancelled");
    cancelStartup?.(error);
    socket?.destroy(error);
    if (daemon?.connected) daemon.disconnect();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    socket = await connect(directory);
    if (!socket) {
      NodeFS.rmSync(socketFile(directory), { force: true });
      daemon = NodeChildProcess.spawn(
        process.execPath,
        [NodeURL.fileURLToPath(import.meta.url), "serve", directory, String(capacity)],
        { detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      await new Promise<void>((resolve, reject) => {
        cancelStartup = reject;
        daemon!.once("error", reject);
        const exited = (code: number | null) =>
          reject(new Error(`PostgreSQL admission broker exited: ${code}`));
        daemon!.once("exit", exited);
        const receive = (message: unknown) => {
          if (message !== "ready") return;
          daemon!.off("message", receive);
          daemon!.off("exit", exited);
          resolve();
        };
        daemon!.on("message", receive);
        if (options.signal?.aborted) abort();
      }).finally(() => {
        cancelStartup = undefined;
      });
      socket = await connect(directory);
      if (!socket) throw new Error("PostgreSQL admission broker vanished after startup");
    }
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("PostgreSQL admission broker connection closed")));
    lines = NodeReadline.createInterface({ input: socket });
    lines.on("error", fail);
    lines.on("line", (line) => {
      if (next) {
        const pending = next;
        next = undefined;
        pending.resolve(line);
      } else inbox.push(line);
    });
    if ((await receive()) !== "connected") throw new Error("Invalid PostgreSQL admission greeting");
    // Publish this client's lifetime under the election lock, before work can be admitted. A
    // replacement broker must wait for all clients of its predecessor to finish or exit.
    unlockGeneration = await acquireProcessLock(generationFile(directory), {
      mode: "shared",
      unref: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    socket?.destroy();
    await unlockGeneration?.();
    options.signal?.removeEventListener("abort", abort);
    throw error;
  } finally {
    if (daemon?.connected) daemon.disconnect();
    daemon?.unref();
    await unlock();
  }
  try {
    options.signal?.throwIfAborted();
    socket.write("acquire\n");
    let reply = await receive();
    if (reply === "waiting") {
      options.onWaiting?.();
      reply = await receive();
    }
    if (reply !== "admitted") throw new Error(`Invalid PostgreSQL admission reply: ${reply}`);
    owned = true;
    socket.unref();
  } catch (error) {
    socket.destroy();
    await unlockGeneration?.();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  let closing: Promise<void> | undefined;
  return {
    release: () =>
      (closing ??= (async () => {
        released = true;
        socket.ref();
        try {
          if (failure) throw failure;
          socket.write("release\n");
          if ((await receive()) !== "released")
            throw new Error("Invalid PostgreSQL admission release receipt");
        } finally {
          lines?.close();
          socket.destroy();
          await unlockGeneration?.();
        }
      })()),
  };
}

async function serve(directory: string, capacity: number) {
  const sockets = new Set<NodeNet.Socket>();
  const admitted = new Set<NodeNet.Socket>();
  const waiting: NodeNet.Socket[] = [];
  let bootstrap = process.connected;
  let stopping = false;
  const drain = () => {
    while (admitted.size < capacity && waiting.length) {
      const socket = waiting.shift()!;
      if (socket.destroyed) continue;
      admitted.add(socket);
      socket.write("admitted\n");
    }
  };
  let idle: Promise<void> | undefined;
  const stopWhenIdle = () => {
    if (bootstrap || sockets.size || idle || stopping) return;
    idle = (async () => {
      const unlock = await acquireProcessLock(electionFile(directory));
      try {
        if (bootstrap || sockets.size) return;
        stopping = true;
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        NodeFS.rmSync(socketFile(directory), { force: true });
      } finally {
        await unlock();
      }
    })()
      .catch((error: unknown) => {
        stopping = true;
        server.close();
        throw error;
      })
      .finally(() => {
        idle = undefined;
        if (!stopping) stopWhenIdle();
      });
    void idle.catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
  };
  const server = NodeNet.createServer((socket) => {
    sockets.add(socket);
    let requested = false;
    const relinquish = () => {
      admitted.delete(socket);
      const index = waiting.indexOf(socket);
      if (index >= 0) waiting.splice(index, 1);
      drain();
    };
    socket.write("connected\n");
    const lines = NodeReadline.createInterface({ input: socket });
    lines.on("line", (command) => {
      if (command === "acquire" && !requested) {
        requested = true;
        waiting.push(socket);
        drain();
        if (!admitted.has(socket)) socket.write("waiting\n");
      } else if (command === "release" && admitted.has(socket)) {
        relinquish();
        socket.end("released\n");
      } else socket.destroy();
    });
    const gone = () => {
      relinquish();
      sockets.delete(socket);
      lines.close();
      stopWhenIdle();
    };
    socket.on("error", () => socket.destroy());
    lines.on("error", () => socket.destroy());
    socket.once("close", gone);
  });
  process.once("disconnect", () => {
    bootstrap = false;
    // No client can have connected before listening; abandon a queued generation election too.
    if (!server.listening) process.exit(0);
    stopWhenIdle();
  });
  // The client's election lock excludes replacement starts. This exclusive barrier also
  // excludes work that outlived a killed broker; old SQL pools may still run after socket loss.
  const generation = acquireProcessLock(generationFile(directory));
  process.send?.("starting");
  const unlockGeneration = await generation;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketFile(directory), resolve);
    });
  } finally {
    await unlockGeneration();
  }
  if (process.connected) process.send?.("ready");
  else stopWhenIdle();
}

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url) && process.argv[2] === "serve") {
  void serve(process.argv[3]!, Number(process.argv[4])).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
