// @effect-diagnostics nodeBuiltinImport:off -- child Vitest processes prove expected failures cannot hide harness errors.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const root = NodeURL.fileURLToPath(new URL("../../../../../", import.meta.url));
async function run(filter: string) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "vp",
      [
        "test",
        "run",
        "--config",
        "apps/web/test/scenarios/harness/fixtures/vitest.config.ts",
        "-t",
        filter,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

it.each([
  ["uncaught page error", "Uncaught browser errors", "health-regression-page-error"],
  ["unmapped HTTP", "Unmapped browser network", "GET https://unmapped.example.test"],
  ["unmapped WebSocket", "Unmapped browser network", "WS https://unmapped.example.test"],
])(
  "fails the suite for %s inside it.fails",
  async (filter, diagnostic, detail) => {
    const result = await run(filter);
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain(diagnostic);
    expect(result.output).toContain(detail);
  },
  20_000,
);

it("a -t filter excluding unhealthy scenarios leaves the suite green", async () => {
  const result = await run("clean filtered browser");
  expect(result.code, result.output).toBe(0);
  expect(result.output).toContain("3 skipped");
}, 20_000);
