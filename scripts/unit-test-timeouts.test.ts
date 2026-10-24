// @effect-diagnostics nodeBuiltinImport:off -- compares runner configuration with CI's hang guard.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { loadConfigFromFile } from "vite-plus";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const workflow = parse(
  NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
) as { jobs: Record<string, { "timeout-minutes": number }> };
it.each([
  { name: "HQ", job: "test_hq", file: "../apps/hq/vite.config.ts" },
  { name: "web", job: "test_web", file: "../apps/web/vite.config.ts" },
])("$name incidental test and hook deadlines outlast CI's hang guard", async ({ job, file }) => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    NodeURL.fileURLToPath(new URL(file, import.meta.url)),
  );
  const root = loaded?.config.test;
  const unit = root?.projects?.find(
    (project) => typeof project === "object" && "test" in project && project.test?.name === "unit",
  );
  const config = typeof unit === "object" && "test" in unit ? unit.test : root;
  const hangGuard = workflow.jobs[job]!["timeout-minutes"] * 60_000;
  for (const phase of ["testTimeout", "hookTimeout"] as const) {
    expect(
      config?.[phase],
      `ASSERTION: ${job} ${phase} must outlast the ${hangGuard}ms CI hang guard; host load is not a test failure`,
    ).toBeGreaterThan(hangGuard);
  }
});
