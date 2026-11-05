// @effect-diagnostics nodeBuiltinImport:off -- CI's runner policy leaves the scenario definitions unchanged.
import * as NodeURL from "node:url";
import { loadConfigFromFile } from "vite-plus";
import { defineConfig } from "vite-plus/test/config";

export default defineConfig(async (env) => {
  const loaded = await loadConfigFromFile(
    env,
    NodeURL.fileURLToPath(new URL("../apps/web/test/scenarios/vitest.config.ts", import.meta.url)),
  );
  if (!loaded) throw new Error("Scenario configuration is missing");
  const scenarios = loaded.config;
  return {
    ...scenarios,
    test: {
      ...scenarios.test,
      projects: scenarios.test!.projects!.map((project) => {
        if (
          typeof project !== "object" ||
          !("test" in project) ||
          project.test?.name !== "scenarios"
        )
          return project;
        return {
          ...project,
          test: {
            ...project.test,
            runner: NodeURL.fileURLToPath(new URL("./scenario-budget-runner.ts", import.meta.url)),
            globalSetup: [
              ...[project.test.globalSetup ?? []].flat(),
              NodeURL.fileURLToPath(new URL("./scenario-budget.setup.ts", import.meta.url)),
            ],
          },
        };
      }),
    },
  };
});
