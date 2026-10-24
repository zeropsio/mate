import GateTimingReporter from "../../../../scripts/gate-timing-reporter.ts";
import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    reporters: ["default", new GateTimingReporter()],
    globalSetup: ["../../scripts/test-postgres.setup.ts"],
    // Bound browser work across both projects; PostgreSQL is shared across runs.
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: "scenarios",
          include: ["test/scenarios/areas/**/*.scenario.ts"],
          environment: "node",
          setupFiles: ["../../packages/shared/src/testing/longTempDir.ts"],
          globalSetup: [
            "test/scenarios/harness/build.ts",
            "test/scenarios/harness/browserProcess.ts",
          ],
          fileParallelism: false,
          // A hang ceiling, never a timing assertion: 6 times the longest case, far under Signal's
          // 25-minute shard guard. A case that reaches it fails as hung, and the shard goes on.
          // Waits stay past it, so a wait ends on its predicate or the ceiling names the case.
          hookTimeout: 3 * 60_000,
          testTimeout: 3 * 60_000,
          expect: { poll: { timeout: 30 * 60_000 } },
        },
      },
      {
        test: {
          name: "scenario-drivers",
          globalSetup: ["test/scenarios/harness/browserProcess.ts"],
          // Tables declare tests through `it.each(rows)("$title", …)`: the title is the row's whole sentence.
          taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER,
          include: ["test/scenarios/fakes/**/*.test.ts"],
          environment: "node",
          // Past Test Packages' 12-minute guard: a receipt wait ends on its receipt, or the job ends it.
          hookTimeout: 15 * 60_000,
          testTimeout: 15 * 60_000,
          expect: { poll: { timeout: 15 * 60_000 } },
        },
      },
    ],
  },
});
