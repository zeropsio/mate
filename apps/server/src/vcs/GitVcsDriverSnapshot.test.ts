// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

import { SNAPSHOT_SCRIPT } from "./GitVcsDriverSnapshot.ts";

it("workspace capture runs on any runtime image with POSIX sh and git", () => {
  // The same fixture runs directly under BusyBox sh on an Alpine service.
  const result = NodeChildProcess.spawnSync(
    "sh",
    [NodeURL.fileURLToPath(new URL("./fixtures/snapshot-posix.sh", import.meta.url))],
    { env: { ...process.env, SNAPSHOT_SCRIPT }, encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("POSIX snapshot assertions passed\n");
});
