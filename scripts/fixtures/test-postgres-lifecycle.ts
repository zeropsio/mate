// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- real-process lifecycle interleaving fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { acquireTestPostgres } from "../test-postgres.ts";
import setup from "../test-postgres.setup.ts";

if (process.argv[2] === "lock") {
  const args = process.argv.slice(3);
  const lifecycle = args[1] === NodePath.join(process.env.MATE_TEST_PG_HOME!, "lifecycle.lock");
  const control = lifecycle
    ? NodeNet.createConnection(process.env.MATE_TEST_LIFECYCLE_CONTROL!)
    : undefined;
  const report = (event: string) =>
    control?.write(
      `${JSON.stringify({ event, role: process.env.MATE_TEST_CLIENT_ROLE, parent: process.ppid })}\n`,
    );
  report("locking");
  const holder = NodeChildProcess.spawn(process.env.MATE_TEST_REAL_FLOCK!, args, {
    stdio: ["pipe", "pipe", "inherit", ...(process.connected ? ["ipc" as const] : [])],
  });
  holder.on("message", (message) => process.send?.(message));
  process.once("disconnect", () => {
    if (holder.connected) holder.disconnect();
  });
  process.stdin.pipe(holder.stdin!);
  holder.stdout!.once("data", (data: Buffer) => {
    report("locked");
    const deliver = () => {
      process.stdout.write(data);
      holder.stdout!.pipe(process.stdout);
      control?.end();
    };
    if (lifecycle && process.env.MATE_TEST_CLIENT_ROLE === "second") control!.once("data", deliver);
    else deliver();
  });
  holder.once("error", (error) => {
    throw error;
  });
  holder.once("exit", (code, signal) => {
    control?.destroy();
    if (process.connected) process.disconnect();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} else if (process.argv[2] === "scenario") {
  const teardown = await setup();
  process.send?.({ event: "admitted" });
  process.on("message", async (message) => {
    if (message !== "release") return;
    await teardown();
    process.send?.({ event: "released" });
    process.disconnect();
  });
} else {
  const owner = await acquireTestPostgres();
  process.send?.({ event: "admitted" });
  const url = await owner.createDatabase();
  process.on("message", async (message) => {
    if (message !== "release") return;
    await owner.close();
    process.send?.({ event: "released" });
    process.disconnect();
  });
  process.send?.({ event: "created", url });
}
