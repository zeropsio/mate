// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- CI and scenario setup share this checkout contract.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** The z3 tree, not the current mate-hq branch, owns the test HQ revision. */
export function readHqRef(root: string): string {
  let ref: string;
  try {
    ref = NodeFS.readFileSync(NodePath.join(root, ".mate-hq-ref"), "utf8").trim();
  } catch {
    throw new Error(".mate-hq-ref must contain one full mate-hq SHA; the file is missing");
  }
  if (!/^[0-9a-f]{40}$/u.test(ref))
    throw new Error(`.mate-hq-ref must contain one full mate-hq SHA; got ${JSON.stringify(ref)}`);
  return ref;
}

/** A promotable web tree must be compatible with an HQ already on production's source branch. */
export function requireHqMain(ref: string, checkout: string): void {
  const main = NodeChildProcess.spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const tip = main.status === 0 ? main.stdout.trim() : "unavailable";
  const ancestry = NodeChildProcess.spawnSync(
    "git",
    ["-C", checkout, "merge-base", "--is-ancestor", ref, tip],
    { encoding: "utf8" },
  );
  if (ancestry.status !== 0)
    throw new Error(`mate-hq pin ${ref} is not contained in mate-hq main ${tip}`);
}

if (import.meta.main) {
  try {
    const ref = readHqRef(process.cwd());
    if (process.argv[2] === "--check-main") requireHqMain(ref, process.argv[3] ?? "mate-hq");
    else console.log(ref);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
