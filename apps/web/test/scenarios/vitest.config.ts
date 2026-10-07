import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    // Keep PostgreSQL fixture startups serial across both test projects.
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: "scenarios",
          include: ["test/scenarios/areas/**/*.scenario.ts"],
          environment: "node",
          globalSetup: ["test/scenarios/harness/build.ts"],
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 45_000,
        },
      },
      {
        test: {
          name: "scenario-drivers",
          include: ["test/scenarios/fakes/**/*.test.ts"],
          environment: "node",
          testTimeout: 10_000,
        },
      },
    ],
  },
});
