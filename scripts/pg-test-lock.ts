// @effect-diagnostics nodeBuiltinImport:off -- a host-wide lock for disposable PostgreSQL test runs.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** Wait in the kernel, before test hooks start. Closing stdin releases the lock, even on exit. */
export default async function setup(
  lock = NodePath.join(NodeOS.tmpdir(), "mate-pg-tests.lock"),
): Promise<() => Promise<void>> {
  const holder = NodeChildProcess.spawn(
    "flock",
    ["-x", lock, process.execPath, "-e", "process.stdout.write('locked'); process.stdin.resume()"],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const closed = new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`PostgreSQL test lock exited: ${code ?? signal}`)),
    );
  });
  await Promise.race([
    new Promise<void>((resolve) => holder.stdout.once("data", () => resolve())),
    closed.then(() => {
      throw new Error("PostgreSQL test lock exited before acquisition");
    }),
  ]);
  return async () => {
    holder.stdin.end();
    await closed;
  };
}
