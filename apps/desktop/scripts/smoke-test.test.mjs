import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "vite-plus/test";

import { cleanupCaptureDirectory, startStaticServer } from "./smoke-test.mjs";

async function withStaticFixture(run) {
  const rootDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-smoke-static-"));
  await NodeFSP.writeFile(NodePath.join(rootDir, "index.html"), "<html>root</html>");
  await NodeFSP.mkdir(NodePath.join(rootDir, "assets"));
  await NodeFSP.writeFile(NodePath.join(rootDir, "assets", "app.js"), "console.log('app');");

  const server = await startStaticServer(rootDir);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

describe("desktop smoke static server", () => {
  it("serves index.html from the bundle root", () =>
    withStaticFixture(async (server) => {
      const response = await fetch(server.url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(await response.text(), "<html>root</html>");
    }));

  it("serves a nested asset with its own content type", () =>
    withStaticFixture(async (server) => {
      const response = await fetch(new URL("assets/app.js", server.url));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
      assert.equal(await response.text(), "console.log('app');");
    }));

  it("falls back to index.html for an unknown path (client-side routing)", () =>
    withStaticFixture(async (server) => {
      const response = await fetch(new URL("some/client/route", server.url));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "<html>root</html>");
    }));

  it("refuses to serve a path that escapes the bundle directory", () =>
    withStaticFixture(async (server) => {
      const response = await fetch(new URL("..%2F..%2Fetc%2Fpasswd", server.url));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "<html>root</html>");
    }));
});

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
