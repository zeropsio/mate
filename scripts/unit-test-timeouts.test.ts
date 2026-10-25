// @effect-diagnostics nodeBuiltinImport:off -- compares runner configuration with CI's hang guard.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { loadConfigFromFile } from "vite-plus";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const jobs = (workflow: string) =>
  (
    parse(
      NodeFS.readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8"),
    ) as { jobs: Record<string, { "timeout-minutes": number }> }
  ).jobs;
it.each([
  {
    name: "HQ",
    workflow: "ci.yml",
    job: "test_hq",
    file: "../apps/hq/vite.config.ts",
    project: "unit",
    polls: false,
  },
  {
    name: "web",
    workflow: "ci.yml",
    job: "test_web",
    file: "../apps/web/vite.config.ts",
    project: "unit",
    polls: false,
  },
  {
    name: "Signal scenarios",
    workflow: "signal.yml",
    job: "chat_scenarios",
    file: "../apps/web/test/scenarios/vitest.config.ts",
    project: "scenarios",
    polls: true,
  },
  {
    name: "scenario drivers",
    workflow: "ci.yml",
    job: "test_packages",
    file: "../apps/web/test/scenarios/vitest.config.ts",
    project: "scenario-drivers",
    polls: true,
  },
  {
    name: "state smoke scenarios",
    workflow: "ci.yml",
    job: "state_smoke",
    file: "../apps/web/test/scenarios/vitest.config.ts",
    project: "scenarios",
    polls: true,
  },
])(
  "$name incidental test and hook deadlines outlast CI's hang guard",
  async ({ workflow, job, file, project, polls }) => {
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      NodeURL.fileURLToPath(new URL(file, import.meta.url)),
    );
    const root = loaded?.config.test;
    const named = root?.projects?.find(
      (entry) => typeof entry === "object" && "test" in entry && entry.test?.name === project,
    );
    const config = typeof named === "object" && "test" in named ? named.test : root;
    const hangGuard = jobs(workflow)[job]!["timeout-minutes"] * 60_000;
    for (const phase of ["testTimeout", "hookTimeout"] as const) {
      expect(
        config?.[phase],
        `ASSERTION: ${job} ${phase} must outlast the ${hangGuard}ms CI hang guard; host load is not a test failure`,
      ).toBeGreaterThan(hangGuard);
    }
    // Vitest's own default for `expect.poll` is one second.
    if (polls)
      expect(
        config?.expect?.poll?.timeout,
        `ASSERTION: ${job} expect.poll must outlast the ${hangGuard}ms CI hang guard; host load is not a test failure`,
      ).toBeGreaterThan(hangGuard);
  },
);
