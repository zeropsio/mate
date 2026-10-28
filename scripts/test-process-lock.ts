// @effect-diagnostics nodeBuiltinImport:off -- kernel-owned locks for test process lifetimes.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeURL from "node:url";

/** The same inode stays in place; the kernel elects one owner and releases it on pipe EOF. */
export async function acquireProcessLock(
  path: string,
  options: {
    readonly mode?: "shared" | "exclusive";
    readonly unref?: boolean;
    readonly signal?: AbortSignal;
  } = {},
): Promise<() => Promise<void>> {
  options.signal?.throwIfAborted();
  const holder = NodeChildProcess.spawn(
    process.execPath,
    [
      NodeURL.fileURLToPath(new URL("./test-process-lock-holder.ts", import.meta.url)),
      path,
      options.mode ?? "exclusive",
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const closed = new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Test process lock exited: ${code ?? signal}`)),
    );
  });
  const abort = () => holder.stdin.end();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.race([
      new Promise<void>((resolve) => holder.stdout.once("data", () => resolve())),
      closed.then(() => {
        throw new Error("Test process lock exited before acquisition");
      }),
    ]);
    options.signal?.throwIfAborted();
  } catch (error) {
    if (options.signal?.aborted) {
      await closed.catch(() => undefined);
      options.signal.throwIfAborted();
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  // Child-process pipe streams are sockets. A lifetime guard must not itself keep an idle
  // owner alive; process exit closes the pipe and releases its kernel lock as usual.
  const ownerPipe = holder.stdin as NodeNet.Socket;
  const receiptPipe = holder.stdout as NodeNet.Socket;
  if (options.unref) {
    holder.unref();
    ownerPipe.unref();
    receiptPipe.unref();
  }
  return async () => {
    holder.ref();
    ownerPipe.ref();
    receiptPipe.ref();
    holder.stdin.end();
    await closed;
  };
}
