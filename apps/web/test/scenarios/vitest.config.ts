import { defineConfig } from "vite-plus/test/config";
import { scenarioPolicy } from "./harness/policy.ts";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    // Browser drivers and scenarios share the host's Chrome/CPU budget. Serialize both projects,
    // including cold bundle construction, rather than letting them overload each other.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "scenarios",
          include: ["test/scenarios/areas/**/*.scenario.ts"],
          environment: "node",
          globalSetup: ["test/scenarios/harness/build.ts"],
          hookTimeout: scenarioPolicy.testMs,
          testTimeout: scenarioPolicy.testMs,
        },
      },
      {
        test: {
          name: "scenario-drivers",
          include: ["test/scenarios/fakes/**/*.test.ts"],
          environment: "node",
          testTimeout: scenarioPolicy.testMs,
        },
      },
    ],
  },
});
