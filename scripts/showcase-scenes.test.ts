// @effect-diagnostics nodeBuiltinImport:off - This host-side test exercises the real Node CLI and a temporary lock file.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { afterEach, expect, it } from "vite-plus/test";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const temporaryDirectories: Array<string> = [];

const isExecFileError = (
  value: unknown,
): value is Error & { readonly code: number; readonly stdout: string; readonly stderr: string } =>
  value instanceof Error &&
  "code" in value &&
  typeof value.code === "number" &&
  "stdout" in value &&
  typeof value.stdout === "string" &&
  "stderr" in value &&
  typeof value.stderr === "string";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

it("--check exits 1 and names a scene when its lock hash is tampered", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "showcase-scenes-"));
  temporaryDirectories.push(directory);
  const sourceLockUrl = new URL(
    "../packages/shared/src/showcaseScenes/v1/scenes.lock",
    import.meta.url,
  );
  const lock = JSON.parse(await NodeFSP.readFile(sourceLockUrl, "utf8")) as {
    contractsVersion: string;
    scenes: Record<string, string>;
  };
  lock.scenes["web:cards"] = "0".repeat(64);
  const lockPath = NodePath.join(directory, "scenes.lock");
  await NodeFSP.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  let failure: unknown;
  try {
    await execFile(process.execPath, [
      NodeURL.fileURLToPath(new URL("./showcase-scenes.ts", import.meta.url)),
      "--check",
      "--lock",
      lockPath,
    ]);
  } catch (error) {
    failure = error;
  }

  expect(isExecFileError(failure)).toBe(true);
  if (!isExecFileError(failure)) {
    return;
  }
  expect(failure.code).toBe(1);
  expect(`${failure.stdout}\n${failure.stderr}`).toContain("web:cards");
});
