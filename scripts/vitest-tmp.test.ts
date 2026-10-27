// @effect-diagnostics nodeBuiltinImport:off -- runs the real test runner in a child process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

// Forked workers read transformed modules from copies under TMPDIR; an unpatched
// runner never removes them and fills the RAM disk test runs share.
it("a test run removes the module copies it wrote to the temp directory", () => {
  const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
  const cache = NodePath.join(root, "node_modules/.cache");
  NodeFS.mkdirSync(cache, { recursive: true });
  const fixture = NodeFS.mkdtempSync(NodePath.join(cache, "vitest-tmp-"));
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "vitest-tmp-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(fixture, "vitest.config.ts"),
      'export default { test: { pool: "forks", include: ["proof.test.ts"] } };',
    );
    NodeFS.writeFileSync(
      NodePath.join(fixture, "proof.test.ts"),
      'import { it } from "vite-plus/test"; it("runs", () => {});',
    );
    const result = NodeChildProcess.spawnSync(
      NodePath.join(root, "node_modules/.bin/vp"),
      ["test", "run", "--config", "vitest.config.ts"],
      { cwd: fixture, encoding: "utf8", env: { ...process.env, TMPDIR: temp } },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    // Node's compile cache is one shared, content-keyed directory that every run reuses.
    expect(NodeFS.readdirSync(temp).filter((name) => name !== "node-compile-cache")).toEqual([]);
  } finally {
    NodeFS.rmSync(fixture, { recursive: true, force: true });
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
});
