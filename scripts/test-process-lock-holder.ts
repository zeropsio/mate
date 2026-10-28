// @effect-diagnostics nodeBuiltinImport:off -- watch the owner's pipe before flock can acquire.
import * as NodeChildProcess from "node:child_process";

// flock cannot observe EOF while queued. This process can, and owns the child it cancels.
const holder = NodeChildProcess.spawn(
  "flock",
  [
    process.argv[3] === "shared" ? "-s" : "-x",
    process.argv[2]!,
    process.execPath,
    "-e",
    "process.stdout.write('locked'); process.stdin.resume()",
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);
let acquired = false;
let abandoned = false;
const abandon = () => {
  abandoned = true;
  holder.stdin.end();
  if (!acquired) holder.kill("SIGTERM");
};
process.stdin.resume();
process.stdin.once("end", abandon);
process.once("SIGTERM", abandon);
process.once("SIGINT", abandon);
holder.stdout.once("data", (data: Buffer) => {
  acquired = true;
  if (!abandoned) process.stdout.write(data);
});
holder.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.stdin.destroy();
  process.exitCode = 1;
});
holder.once("exit", (code) => {
  process.stdin.destroy();
  process.exitCode = abandoned ? 0 : (code ?? 1);
});
