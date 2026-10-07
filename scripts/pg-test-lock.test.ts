// @effect-diagnostics nodeBuiltinImport:off -- exercise the operating system's test lock.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import acquireLock from "./pg-test-lock.ts";

it("queues another holder until the exclusive lock is released", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-lock-test-"));
  const lock = NodePath.join(directory, "lock");
  const release = await acquireLock(lock);
  try {
    expect(NodeChildProcess.spawnSync("flock", ["-xn", lock, "true"]).status).toBe(1);
    const queued = acquireLock(lock);
    await release();
    const releaseNext = await queued;
    try {
      expect(NodeChildProcess.spawnSync("flock", ["-xn", lock, "true"]).status).toBe(1);
    } finally {
      await releaseNext();
    }
    expect(NodeChildProcess.spawnSync("flock", ["-xn", lock, "true"]).status).toBe(0);
  } finally {
    await release();
    NodeFS.rmSync(directory, { recursive: true });
  }
});
