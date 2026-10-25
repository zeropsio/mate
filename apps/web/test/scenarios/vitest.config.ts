import GateTimingReporter from "../../../../scripts/gate-timing-reporter.ts";
import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";
import { useTestScratchRoot } from "../../../../scripts/lib/test-scratch-root.ts";

useTestScratchRoot(process.env);

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
          hookTimeout: 120_000,
          testTimeout: 45_000,
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
          testTimeout: 10_000,
        },
      },
    ],
  },
});
