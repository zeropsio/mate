// @effect-diagnostics nodeBuiltinImport:off -- real psql completion barrier.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";

const args = process.argv.slice(2);
const child = NodeChildProcess.spawn(process.env.MATE_TEST_REAL_PSQL!, args, {
  stdio: ["inherit", "pipe", "pipe"],
});
const output: Buffer[] = [];
child.stdout.on("data", (data: Buffer) => output.push(data));
child.stderr.pipe(process.stderr);
child.once("error", (error) => {
  throw error;
});
child.once("close", (code) => {
  const deliver = () => {
    for (const data of output) process.stdout.write(data);
    process.exitCode = code ?? 1;
  };
  if (!args.some((arg) => arg.includes("pg_stat_activity"))) {
    deliver();
    return;
  }
  const control = NodeNet.createConnection(process.env.MATE_TEST_DRAIN_CONTROL!);
  control.once("connect", () =>
    control.write(`${JSON.stringify({ output: Buffer.concat(output).toString() })}\n`),
  );
  control.once("data", () => {
    control.end();
    deliver();
  });
});
