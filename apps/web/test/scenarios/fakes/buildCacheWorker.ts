// @effect-diagnostics nodeBuiltinImport:off -- independent builder process for cache ownership tests.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { cachedBundle } from "../harness/buildCache.ts";

const command = (expected: string) =>
  new Promise<void>((resolve, reject) =>
    process.once("message", (message) =>
      message === expected ? resolve() : reject(new Error(`Expected ${expected}`)),
    ),
  );

process.once("disconnect", () => process.exit(1));
async function main() {
  const start = command("start");
  process.send?.("ready");
  await start;
  process.send?.("attempting");
  const dist = await cachedBundle(process.argv[2]!, {}, async (dist) => {
    const finish = command("finish");
    process.send?.("building");
    await finish;
    await NodeFSP.writeFile(NodePath.join(dist, "index.html"), "finished bundle");
  });
  process.send?.({
    dist,
    content: await NodeFSP.readFile(NodePath.join(dist, "index.html"), "utf8"),
  });
  process.removeAllListeners("disconnect");
  process.disconnect();
}
main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
