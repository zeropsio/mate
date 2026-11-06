// @effect-diagnostics nodeBuiltinImport:off -- runs the real test runner in a child process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
let fixture: string;
let temp: string;
let result: ReturnType<typeof NodeChildProcess.spawnSync>;

beforeAll(() => {
  const cache = NodePath.join(root, "node_modules/.cache");
  NodeFS.mkdirSync(cache, { recursive: true });
  fixture = NodeFS.mkdtempSync(NodePath.join(cache, "vitest-tmp-"));
  temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "vitest-tmp-"));
  const tempAlias = NodePath.join(fixture, "temp-alias");
  let tempForWorker = temp;
  if (HostProcessPlatform.defaultValue() === "darwin") {
    NodeFS.symlinkSync(temp, tempAlias, "dir");
    tempForWorker = tempAlias;
  }
  NodeFS.writeFileSync(
    NodePath.join(fixture, "vitest.config.ts"),
    `export default { test: { pool: "forks", include: ["proof.test.ts"], globalSetup: [${JSON.stringify(NodePath.join(root, "packages/shared/src/testing/longTempDir.ts"))}] } };`,
  );
  NodeFS.writeFileSync(
    NodePath.join(fixture, "proof.test.ts"),
    'import { it } from "vite-plus/test"; import * as fs from "node:fs"; import * as os from "node:os"; it("runs", () => fs.writeFileSync("temp-used.txt", os.tmpdir()));',
  );
  result = NodeChildProcess.spawnSync(
    NodePath.join(root, "node_modules/.bin/vp"),
    ["test", "run", "--config", "vitest.config.ts"],
    {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tempForWorker, TEMP: tempForWorker, TMP: tempForWorker },
    },
  );
});

afterAll(() => {
  NodeFS.rmSync(fixture, { recursive: true, force: true });
  NodeFS.rmSync(temp, { recursive: true, force: true });
});

// Forked workers read transformed modules from copies under TMPDIR; an unpatched
// runner never removes them and fills the RAM disk test runs share.
it("a test run removes the module copies it wrote to the temp directory", () => {
  expect(result.status, String(result.stdout) + String(result.stderr)).toBe(0);
  // Node's compile cache is one shared, content-keyed directory that every run reuses.
  expect(NodeFS.readdirSync(temp).filter((name) => name !== "node-compile-cache")).toEqual([]);
});

it("a test run normalizes its workers' temporary directory before they start", () => {
  expect(NodeFS.readFileSync(NodePath.join(fixture, "temp-used.txt"), "utf8")).toBe(
    NodeFS.realpathSync.native(temp),
  );
});
