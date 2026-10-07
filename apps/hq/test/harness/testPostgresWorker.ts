// @effect-diagnostics nodeBuiltinImport:off -- killed-worker fixture, only used by the supervisor test.
import { acquireTestPostgres } from "../../../../scripts/test-postgres.ts";
const owner = await acquireTestPostgres();
process.send?.(await owner.createDatabase());
process.stdin.resume();
process.stdin.once("end", () => {
  void owner.close().then(() => {
    if (process.connected) process.disconnect();
  });
});

process.once("message", (message) => {
  if (message === "exit") process.exit(0);
});
