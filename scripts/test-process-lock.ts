// @effect-diagnostics nodeBuiltinImport:off -- kernel-owned locks for test process lifetimes.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

/** The same inode stays in place; the kernel elects one owner and releases it on pipe EOF. */
export async function acquireProcessLock(path: string): Promise<() => Promise<void>> {
  const holder = NodeChildProcess.spawn(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./test-process-lock-holder.ts", import.meta.url)), path],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const closed = new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Test process lock exited: ${code ?? signal}`)),
    );
  });
  await Promise.race([
    new Promise<void>((resolve) => holder.stdout.once("data", () => resolve())),
    closed.then(() => {
      throw new Error("Test process lock exited before acquisition");
    }),
  ]);
  return async () => {
    holder.stdin.end();
    await closed;
  };
}
