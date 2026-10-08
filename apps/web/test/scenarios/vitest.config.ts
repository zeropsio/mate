import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    globalSetup: ["../../scripts/test-postgres.setup.ts"],
    // Bound browser work across both projects; PostgreSQL is shared across runs.
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
      // The chat journeys again, against a Mate whose conversation runs on the engine's wire.
      // Asked for by name (MATE_SCENARIOS_ENGINE=1) until all 13 pass: journey 9 attaches a
      // picture to an answer, which engine protocol 1 cannot carry. Then it joins chat-gate.
      ...(process.env.MATE_SCENARIOS_ENGINE === "1"
        ? [
            {
              test: {
                name: "scenarios-engine",
                include: ["test/scenarios/areas/c-mate/chat.scenario.ts"],
                environment: "node" as const,
                globalSetup: ["test/scenarios/harness/build.ts"],
                fileParallelism: false,
                hookTimeout: 120_000,
                testTimeout: 45_000,
                provide: { mateWire: "engine" as const },
              },
            },
          ]
        : []),
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
