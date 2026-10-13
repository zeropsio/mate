import GateTimingReporter from "../../../../scripts/gate-timing-reporter.ts";
import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    reporters: ["default", new GateTimingReporter()],
    globalSetup: ["../../scripts/test-postgres.setup.ts"],
    // Files share Chrome, while every case owns its context, loopback ports and cloned DB.
    maxWorkers: 2,
    projects: [
      {
        test: {
          name: "scenarios",
          include: ["test/scenarios/areas/**/*.scenario.ts"],
          environment: "node",
          globalSetup: [
            "test/scenarios/harness/build.ts",
            "test/scenarios/harness/browserProcess.ts",
          ],
          fileParallelism: true,
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
          // browserLifecycle counts every context in the shared Chrome.
          fileParallelism: false,
          testTimeout: 10_000,
        },
      },
    ],
  },
});
