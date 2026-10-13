// @effect-diagnostics nodeBuiltinImport:off -- executes CI's own path selector and inspects its jobs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { expect, it } from "vite-plus/test";
import { chatGateStages } from "./chat-gate.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const { jobs } = parse(
  NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
) as {
  jobs: Record<
    string,
    {
      name: string;
      steps: { name: string; run?: string; if?: string; env?: Record<string, string> }[];
      strategy?: { matrix: { include: { command: string }[] } };
    }
  >;
};

it("Decision: supersede pending main runs; never cancel a running deploy", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as { concurrency: { group: string; "cancel-in-progress": string; queue?: string } };
  expect(
    workflow.concurrency.group,
    "ASSERTION: main pushes must share one CI concurrency group to replace older pending runs",
  ).toBe("ci-${{ github.event.pull_request.number || github.ref }}");
  expect(
    workflow.concurrency["cancel-in-progress"],
    "ASSERTION: only PRs may cancel an in-progress CI run",
  ).toBe("${{ github.event_name == 'pull_request' }}");
  expect(workflow.concurrency.queue ?? "single").toBe("single");
  const release = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
  ) as { concurrency?: { "cancel-in-progress"?: boolean } };
  expect(
    release.concurrency?.["cancel-in-progress"] ?? false,
    "ASSERTION: a running release must finish",
  ).toBe(false);
});

const scenarioPaths = NodeFS.readdirSync(NodePath.join(root, "apps/web/test/scenarios/areas"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => `apps/web/test/scenarios/areas/${entry.name}/journey.scenario.ts`);

it.each([
  "apps/hq/src/core.ts",
  "apps/hq/package.json",
  ...scenarioPaths,
  "apps/web/test/scenarios/areas/future/journey.scenario.ts",
  "apps/web/test/scenarios/fakes/g-outage/outage.ts",
  "apps/web/test/scenarios/harness/scenario.ts",
  "scripts/test-postgres.ts",
  "apps/server/src/engine/engine.ts",
  "packages/client-runtime/src/data.ts",
])("PR scenarios run when their input %s changes", (path) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-ci-selection-"));
  const output = NodePath.join(directory, "output");
  try {
    const run = jobs.changes!.steps.find((step) => step.name === "Detect changed areas")!.run!;
    const selection = run.slice(run.indexOf("          paths=".trimStart()));
    const result = NodeChildProcess.spawnSync("bash", ["-c", selection], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, rows: path, PR_NUMBER: "1", GITHUB_OUTPUT: output },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      NodeFS.readFileSync(output, "utf8"),
      "ASSERTION: a PR changing a scenario input must select the bundle and all scenario shards",
    ).toMatch(/^chat=true$/mu);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

it("Decision: no test removed from CI coverage", () => {
  expect(
    jobs.chat_gate,
    "ASSERTION: duplicate A/E/F runs are folded into Test Server",
  ).toBeUndefined();
  const server = jobs.test_server!;
  const test = server.steps.find((step) => step.name === "Test")!;
  expect(test.run).toContain("vp run --filter t3 test --shard");
  expect(test.run).toContain("--allowOnly=false");
  expect(test.run).toContain("--reporter=../../scripts/chat-gate-reporter.ts");
  expect(test.env?.MATE_CHAT_GATE_SERVER).toBe("1");
  const oracle = server.steps.find((step) => step.name === "Certify engine oracles")!;
  expect(oracle.if).toBe("matrix.shard == 1");
  expect(oracle.run).toContain("test/engine-oracle/runCard.oracle.test.ts");
  expect(oracle.run).toContain("test/engine-oracle/mateHealth.oracle.test.ts");
  expect(oracle.run).toContain("--allowOnly=false");
  expect(oracle.run).toContain("--reporter=../../scripts/chat-gate-reporter.ts");
  expect(oracle.run).toContain(
    "tsc --noEmit --incremental -p apps/web/test/engine-oracle/tsconfig.json",
  );
});

it("C scenario shards expose every case's timing in the CI log", () => {
  const commands = jobs.chat_scenarios!.strategy!.matrix.include.map((row) => row.command);
  const c = commands.filter((command) => command.startsWith("node scripts/chat-gate.ts"));
  expect(c).toHaveLength(4);
  for (const command of c)
    expect(command, "ASSERTION: C shards must expose Vitest per-case timings").toContain(
      "--verbose",
    );
});

it("CI runs the same named gate as local ports", () => {
  const server = jobs.test_server!.steps.find((step) => step.name === "Test")!;
  expect(server.run).toContain("vp run --filter t3 test --shard");
  expect(server.run).toContain("--reporter=../../scripts/chat-gate-reporter.ts");
  expect(server.env?.MATE_CHAT_GATE_SERVER).toBe("1");
  const oracle = jobs.test_server!.steps.find(
    (step) => step.name === "Certify engine oracles",
  )!.run!;
  for (const stage of chatGateStages.filter((stage) => ["A", "E", "F"].includes(stage.id))) {
    for (const command of stage.commands.filter((command) => command.cwd === "apps/web")) {
      for (const file of command.args.filter((arg) => arg.endsWith(".test.ts"))) {
        expect(oracle).toContain(file);
      }
    }
  }
});

it("CI builds once and certifies both complete C shards from that artifact", () => {
  const { jobs } = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        needs: string;
        strategy?: { "fail-fast": boolean; matrix: { include: { command: string }[] } };
        steps: {
          uses?: string;
          run?: string;
          with?: Record<string, unknown>;
          env?: Record<string, string>;
        }[];
      }
    >;
  };
  const build = jobs.chat_bundle!;
  const journeys = jobs.chat_scenarios!;
  expect(build.needs).toBe("changes");
  expect(build.steps.filter((step) => step.run).map((step) => step.run)).toEqual([
    "vp exec node apps/web/test/scenarios/harness/build.ts",
  ]);
  expect(journeys.needs).toBe("chat_bundle");
  expect(journeys.strategy?.["fail-fast"]).toBe(false);
  expect(journeys.strategy?.matrix.include.slice(0, 4).map((row) => row.command)).toEqual([
    "node scripts/chat-gate.ts --verbose --stages C --shard 1/4",
    "node scripts/chat-gate.ts --verbose --stages C --shard 2/4",
    "node scripts/chat-gate.ts --verbose --stages C --shard 3/4",
    "node scripts/chat-gate.ts --verbose --stages C --shard 4/4",
  ]);
  const uploaded = build.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
  const downloaded = journeys.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  )!;
  expect(uploaded.with).toMatchObject({
    "include-hidden-files": true,
    "if-no-files-found": "error",
  });
  expect(downloaded.with).toEqual({ name: uploaded.with!.name, path: uploaded.with!.path });
  expect(journeys.steps.filter((step) => step.run)).toEqual([
    expect.objectContaining({
      run: "${{ matrix.command }}",
      env: { MATE_SCENARIO_REQUIRE_BUNDLE: "1" },
    }),
  ]);
});

it("the Test verdict includes every scripts and HQ shard", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  expect(workflow.jobs.test.needs, "ASSERTION: Test must wait for every split package").toEqual([
    "test_packages",
    "test_scripts",
    "test_hq",
  ]);
  expect(workflow.jobs.test.if).toBe("${{ !cancelled() }}");
  expect(workflow.jobs.test.steps.at(-1).run).toContain("contains(needs.*.result, 'failure')");
  expect(workflow.jobs.test.steps.at(-1).run).toContain("contains(needs.*.result, 'skipped')");
  for (const name of ["test_scripts", "test_hq"]) {
    expect(workflow.jobs[name].strategy.matrix.shard).toEqual([1, 2]);
    expect(workflow.jobs[name].strategy["fail-fast"]).toBe(false);
    expect(workflow.jobs[name].steps.at(-1).run).toContain(
      "--shard ${{ matrix.shard }}/${{ strategy.job-total }}",
    );
  }
  expect(
    workflow.jobs.test_packages.needs,
    "ASSERTION: package execution must not wait for the split suites",
  ).toBeUndefined();
  const command = workflow.jobs.test_packages.steps.find(
    (step: { name: string }) => step.name === "Test",
  ).run;
  expect(command).toContain("--filter '!@t3tools/scripts'");
  expect(command).toContain("--filter '!@t3tools/hq'");
});

it("hosted web CI omits desktop and mobile jobs and work", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  for (const job of ["desktop_smoke", "test_mobile", "mobile_native_static_analysis"])
    expect(
      workflow.jobs[job],
      "ASSERTION: unused clients must not consume CI runners",
    ).toBeUndefined();
  expect(Object.keys(workflow.jobs.changes.outputs).sort()).toEqual(["chat", "resource_monitor"]);
  expect(workflow.jobs.rust).toBeDefined();
  expect(workflow.jobs.release_smoke).toBeDefined();
  const steps = workflow.jobs.check.steps as { name: string; run?: string }[];
  expect(steps.some((step) => /Electron|mobile/u.test(step.name))).toBe(false);
  const typecheck = steps.find((step) => step.name === "Typecheck")!.run!;
  expect(typecheck, "ASSERTION: CI and local Check delegate the owned hosted-web task").toBe(
    "vpr typecheck",
  );
  const rootTypecheck = JSON.parse(NodeFS.readFileSync(NodePath.join(root, "package.json"), "utf8"))
    .scripts.typecheck as string;
  for (const client of ["desktop", "mobile"])
    expect(rootTypecheck).toContain(`--filter '!@t3tools/${client}'`);
  expect(
    rootTypecheck,
    "ASSERTION: Vite+ cannot combine recursive mode with filters",
  ).not.toContain(" -r ");
  expect(rootTypecheck).toContain("--filter '!@t3tools/monorepo'");
  const check = steps.find((step) => step.name === "Check")!.run!;
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-ci-web-only-"));
  try {
    const executable = NodePath.join(directory, "vp");
    const output = NodePath.join(directory, "selected");
    NodeFS.writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$SELECTED"\n', {
      mode: 0o755,
    });
    const result = NodeChildProcess.spawnSync("bash", ["-c", check], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SELECTED: output },
    });
    expect(result.status, result.stderr).toBe(0);
    const selected = NodeFS.readFileSync(output, "utf8").split("\n");
    expect(selected, "ASSERTION: hosted web source remains checked").toContain(
      "apps/web/package.json",
    );
    expect(
      selected.some((path) => /^apps\/(desktop|mobile)\//u.test(path)),
      "ASSERTION: Check must exclude unused client files",
    ).toBe(false);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
  const test = workflow.jobs.test_packages.steps.find(
    (step: { name: string }) => step.name === "Test",
  ).run;
  expect(test).toContain("--filter '!@t3tools/desktop'");
  expect(
    workflow.jobs.test_packages.steps.some((step: { name: string }) =>
      step.name.includes("Electron"),
    ),
  ).toBe(false);
});
