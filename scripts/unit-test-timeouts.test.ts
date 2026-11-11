// @effect-diagnostics nodeBuiltinImport:off -- compares runner configuration with CI's hang guard.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { parseSync, Visitor } from "oxc-parser";
import { loadConfigFromFile } from "vite-plus";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const jobs = (workflow: string) =>
  (
    parse(
      NodeFS.readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8"),
    ) as { jobs: Record<string, { "timeout-minutes": number }> }
  ).jobs;
async function projectConfig(file: string, project: string) {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    NodeURL.fileURLToPath(new URL(file, import.meta.url)),
  );
  const root = loaded?.config.test;
  const named = root?.projects?.find(
    (entry) => typeof entry === "object" && "test" in entry && entry.test?.name === project,
  );
  return typeof named === "object" && "test" in named ? named.test : root;
}

it.each([
  {
    name: "web",
    workflow: "ci.yml",
    job: "test_web",
    file: "../apps/web/vite.config.ts",
    project: "unit",
    polls: false,
  },
  {
    name: "scenario drivers",
    workflow: "ci.yml",
    job: "test_packages",
    file: "../apps/web/test/scenarios/vitest.config.ts",
    project: "scenario-drivers",
    polls: true,
  },
])(
  "$name incidental test and hook deadlines outlast CI's hang guard",
  async ({ workflow, job, file, project, polls }) => {
    const config = await projectConfig(file, project);
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

// The scenarios run real browsers one after another: a case that never ends would hold its shard
// to the job guard. Their case deadline is a hang ceiling that names the case, not a timing check.
const LONGEST_SCENARIO_CASE_MS = 30_000;

const scenarioRoot = new URL("../apps/web/test/scenarios/areas/", import.meta.url);
const scenarioDeadlines = NodeFS.readdirSync(scenarioRoot, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".scenario.ts"))
  .flatMap((file) => {
    const { program, errors } = parseSync(
      file,
      NodeFS.readFileSync(new URL(file, scenarioRoot), "utf8"),
    );
    if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
    const deadlines: { file: string; title: string; timeout: number }[] = [];
    new Visitor({
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "it" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "effect"
        )
          return;
        const [title, , timeout] = node.arguments;
        if (
          title?.type === "Literal" &&
          typeof title.value === "string" &&
          timeout?.type === "Literal" &&
          typeof timeout.value === "number"
        )
          deadlines.push({ file, title: title.value, timeout: timeout.value });
      },
    }).visit(program);
    return deadlines;
  });

it.each([
  { name: "Signal scenarios", workflow: "signal.yml", job: "chat_scenarios" },
  { name: "state smoke scenarios", workflow: "ci.yml", job: "state_smoke" },
])(
  "$name end a hung case at a ceiling above the longest case and below CI's hang guard",
  async ({ workflow, job }) => {
    const config = await projectConfig("../apps/web/test/scenarios/vitest.config.ts", "scenarios");
    const hangGuard = jobs(workflow)[job]!["timeout-minutes"] * 60_000;
    for (const phase of ["testTimeout", "hookTimeout"] as const) {
      expect(
        config?.[phase],
        `ASSERTION: ${job} ${phase} is a hang ceiling over the longest case and under the ${hangGuard}ms CI hang guard`,
      ).toBeGreaterThan(LONGEST_SCENARIO_CASE_MS);
      expect(config?.[phase]).toBeLessThan(hangGuard);
    }
    // Waits stay past the ceiling, so only the ceiling ends a stuck case and it names the case.
    expect(config?.expect?.poll?.timeout).toBeGreaterThan(config?.testTimeout ?? Infinity);
    for (const { file, title, timeout } of scenarioDeadlines) {
      expect(
        timeout,
        `ASSERTION: ${file} > ${title} must not override the hang ceiling below the longest case`,
      ).toBeGreaterThan(LONGEST_SCENARIO_CASE_MS);
      expect(timeout).toBeLessThan(hangGuard);
    }
  },
);
