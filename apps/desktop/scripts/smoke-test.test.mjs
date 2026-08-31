import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "vite-plus/test";

import { cleanupCaptureDirectory } from "./smoke-test.mjs";

describe("desktop smoke capture cleanup", () => {
  it("keeps local failure evidence and reports its directory", async () => {
    const captureDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "desktop-smoke-cleanup-test-"),
    );
    const reports = [];

    try {
      const exitCode = await cleanupCaptureDirectory(captureDirectory, {
        runnerTemp: undefined,
        exitCode: 1,
        report: (message) => reports.push(message),
      });

      assert.equal(exitCode, 1);
      await NodeFSP.access(captureDirectory);
      assert.deepEqual(reports, [`Desktop smoke failure evidence kept at: ${captureDirectory}`]);
    } finally {
      await NodeFSP.rm(captureDirectory, { recursive: true, force: true });
    }
  });

  it("warns without failing when local success cleanup fails", async () => {
    const reports = [];
    const exitCode = await cleanupCaptureDirectory("/tmp/desktop-smoke-cleanup-test", {
      runnerTemp: undefined,
      exitCode: 0,
      remove: async () => {
        throw new Error("cleanup boom");
      },
      report: (message) => reports.push(message),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(reports, ["Desktop smoke temp cleanup warning: cleanup boom"]);
  });

  it("keeps successful CI evidence when runner temp is provided", async () => {
    let removed = false;
    const exitCode = await cleanupCaptureDirectory("/tmp/desktop-smoke-cleanup-test", {
      runnerTemp: "/tmp/fake",
      exitCode: 0,
      remove: async () => {
        removed = true;
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(removed, false);
  });
});
