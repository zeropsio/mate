// @effect-diagnostics nodeBuiltinImport:off -- executes CI's own path selector and inspects its jobs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { expect, it } from "vite-plus/test";
import { chatGateStages } from "./chat-gate.ts";

const root = NodePath.resolve(import.meta.dirname, "..");

it("CI verifies the frozen lockfile once in Check and keeps local installs protected", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as {
    env?: Record<string, string>;
    jobs: Record<
      string,
      {
        env?: Record<string, string>;
        steps: {
          uses?: string;
          env?: Record<string, string>;
          with?: Record<string, unknown>;
        }[];
      }
    >;
  };
  const verifying: string[] = [];
  const consumers: Record<string, string>[] = [];
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps.filter((step) => step.uses === "voidzero-dev/setup-vp@v1")) {
      expect(step.with?.["run-install"]).not.toBe(false);
      const env = { ...workflow.env, ...job.env, ...step.env };
      consumers.push(env);
      if (env.PNPM_CONFIG_TRUST_LOCKFILE !== "true") verifying.push(name);
    }
  }
  expect(
    verifying,
    "ASSERTION: only Check may repeat the registry-backed lockfile policy verification",
  ).toEqual(["check"]);
  for (const env of consumers)
    expect(
      env.PNPM_CONFIG_FROZEN_LOCKFILE,
      "ASSERTION: CI consumers must install the frozen lockfile that Check verifies",
    ).toBe("true");
  const policy = parse(NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8"));
  expect(policy.trustLockfile ?? false).toBe(false);
  expect(policy.minimumReleaseAge ?? 1440).toBeGreaterThan(0);
});

it("tagged release installs reuse CI verification while manual rehearsals verify", () => {
  const release = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
  );
  expect(release.jobs.ci.if).toBe("github.event_name == 'push'");
  expect(release.jobs.ci.uses).toBe("./.github/workflows/ci.yml");
  const install = release.jobs.build.steps.find(
    (step: { name: string }) => step.name === "Install dependencies",
  );
  expect(install.run).toBe("vp install --frozen-lockfile");
  expect(
    install.env?.PNPM_CONFIG_TRUST_LOCKFILE,
    "ASSERTION: release rehearsals without a called CI check must verify their lockfile",
  ).toBe("${{ github.event_name == 'push' }}");
});

it("release smoke can regenerate its fixture lockfile without inheriting frozen install settings", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const job = workflow.jobs.release_smoke;
  const step = job.steps.find(
    (step: { name: string }) => step.name === "Exercise release-only workflow steps",
  );
  const env = { ...workflow.env, ...job.env, ...step.env };
  expect(
    env.PNPM_CONFIG_FROZEN_LOCKFILE,
    "ASSERTION: release smoke must be able to regenerate its fixture lockfile",
  ).toBeUndefined();
  expect(
    env.PNPM_CONFIG_TRUST_LOCKFILE,
    "ASSERTION: only installs consuming Check's frozen lockfile may skip policy verification",
  ).toBeUndefined();
});

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
  expect(oracle.if).toContain("matrix.shard == 1");
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
        needs: string | string[];
        strategy?: { "fail-fast": boolean; matrix: { include: { command: string }[] } };
        steps: {
          uses?: string;
          if?: string;
          run?: string;
          with?: Record<string, unknown>;
          env?: Record<string, string>;
        }[];
      }
    >;
  };
  const build = jobs.chat_bundle!;
  const journeys = jobs.chat_scenarios!;
  expect(build.needs).toEqual(["prepare", "changes"]);
  expect(
    build.steps
      .filter((step) => step.run && step.if !== "needs.prepare.outputs.skip == 'true'")
      .map((step) => step.run),
  ).toEqual(["vp exec node apps/web/test/scenarios/harness/build.ts"]);
  expect(journeys.needs).toEqual(["prepare", "chat_bundle"]);
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
  expect(
    journeys.steps.filter((step) => step.run && step.if !== "needs.prepare.outputs.skip == 'true'"),
  ).toEqual([
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
    "prepare",
    "test_packages",
    "test_scripts",
    "test_hq",
  ]);
  expect(workflow.jobs.test.if).toBe("${{ !cancelled() && needs.prepare.result == 'success' }}");
  expect(workflow.jobs.test.steps.at(-1).run).toContain("contains(needs.*.result, 'failure')");
  expect(workflow.jobs.test.steps.at(-1).run).toContain("contains(needs.*.result, 'skipped')");
  for (const name of ["test_scripts", "test_hq"]) {
    expect(
      workflow.jobs[name].strategy.matrix.shard,
      "ASSERTION: short suites must not pay duplicate checkout and installation",
    ).toEqual([1]);
    expect(workflow.jobs[name].strategy["fail-fast"]).toBe(false);
    expect(workflow.jobs[name].steps.at(-1).run).toContain(
      "--shard ${{ matrix.shard }}/${{ strategy.job-total }}",
    );
  }
  expect(
    workflow.jobs.test_packages.needs,
    "ASSERTION: package execution must not wait for the split suites",
  ).toBe("prepare");
  const command = workflow.jobs.test_packages.steps.find(
    (step: { name: string }) => step.name === "Test",
  ).run;
  expect(command).toContain("--filter '!@t3tools/scripts'");
  expect(command).toContain("--filter '!@t3tools/hq'");
});

it("HQ's offline shallow clone receives every object in its current commit", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const checkout = workflow.jobs.test_hq.steps.find(
    (step: { name: string }) => step.name === "Checkout",
  );
  expect(
    checkout.with?.["sparse-checkout"],
    "ASSERTION: HQ's offline clone cannot serve missing promisor objects",
  ).toBeUndefined();
  expect(checkout.with?.filter).toBeUndefined();
});

it("hosted suites install their working set while native jobs retain their dependencies", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const install = (name: string) =>
    workflow.jobs[name].steps.find((step: { name: string }) => step.name === "Setup Vite+").with[
      "run-install"
    ];
  for (const name of ["chat_bundle", "chat_scenarios", "test_hq", "test_web"]) {
    expect(
      typeof install(name),
      "ASSERTION: hosted-only test runners must not install unused native workspaces",
    ).toBe("string");
    expect(parse(install(name))).toEqual({
      args: ["--filter=!@t3tools/mobile", "--filter=!@t3tools/desktop"],
    });
  }
  // Scripts executes the shipped mobile Legend List patch; server projection tests
  // consume the mobile feed, whose transform requires Expo's tsconfig.
  for (const name of ["test_scripts", "test_server"]) {
    expect(
      parse(install(name)),
      "ASSERTION: cross-client suites must install the mobile dependencies their consumers read",
    ).toEqual({ args: ["--filter=!@t3tools/desktop"] });
  }
  for (const name of ["check", "test_packages", "desktop_smoke", "test_mobile"])
    expect(install(name)).toBe(true);
});

it("hosted web CI retains native compilation and dedicated native jobs", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  for (const job of ["desktop_smoke", "test_mobile", "mobile_native_static_analysis"])
    expect(
      workflow.jobs[job],
      "ASSERTION: native CI jobs remain covered during the hosted web test phase",
    ).toBeDefined();
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
    expect(rootTypecheck).not.toContain(`--filter '!@t3tools/${client}'`);
  expect(
    rootTypecheck.includes(" -r ") && rootTypecheck.includes("--filter"),
    "ASSERTION: Vite+ cannot combine recursive mode with filters",
  ).toBe(false);
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
  expect(test).not.toContain("--filter '!@t3tools/desktop'");
  expect(
    workflow.jobs.test_packages.steps.some((step: { name: string }) =>
      step.name.includes("Electron"),
    ),
  ).toBe(true);
});

it("CI runs full verification on integration pushes and preserves PR change selection", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  expect(
    workflow.on.push.branches,
    "ASSERTION: only current integration refs trigger push CI",
  ).toEqual(["main", "kh-next", "kh-bisect/**"]);
  expect(workflow.on.pull_request).toBeNull();
  expect(workflow.on.workflow_call).toBeNull();
  expect(workflow["run-name"]).toBe("CI · ${{ github.ref_name }}");
  expect(workflow.jobs.prepare.outputs).toEqual({ skip: "${{ steps.verdict.outputs.skip }}" });
  for (const [name, job] of Object.entries(workflow.jobs) as [
    string,
    { needs?: string | string[]; if?: string },
  ][]) {
    if (name === "prepare") continue;
    expect([job.needs].flat(), `ASSERTION: ${name} reads the one promotion verdict`).toContain(
      "prepare",
    );
    expect(job.if).not.toContain("outputs.level");
  }
  expect(
    workflow.jobs.test_packages.steps.find(
      (step: { name: string }) => step.name === "Test scenario drivers",
    ).if,
  ).toBeUndefined();
  expect(workflow.jobs.chat_bundle.if).toContain("needs.changes.outputs.chat != 'false'");
  expect(workflow.jobs.rust.if).toContain("needs.changes.outputs.resource_monitor != 'false'");
  expect(workflow.jobs.prepare.permissions.actions).toBe("read");
});

it("main promotion reports successful required checks without repeating verified work", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const required = {
    check: "Check",
    test: "Test",
    test_web: "Test Web ${{ matrix.shard }}",
    chat_scenarios: "Test Web Scenarios (${{ matrix.name }})",
    test_server: "Test Server ${{ matrix.shard }}",
    chat_bundle: "Chat Contract bundle",
    release_smoke: "Release Smoke",
  };
  for (const [id, name] of Object.entries(required)) {
    const job = workflow.jobs[id];
    expect(job.name).toBe(name);
    expect(job.if, `ASSERTION: ${name} must run to report promotion success`).toContain(
      "needs.prepare.result == 'success'",
    );
    const promotion = job.steps.filter(
      (step: { if?: string }) => step.if === "needs.prepare.outputs.skip == 'true'",
    );
    expect(promotion, `ASSERTION: ${name} has exactly one promotion receipt`).toHaveLength(1);
    const result = NodeChildProcess.spawnSync("bash", ["-e", "-c", promotion[0].run], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    for (const step of job.steps.filter(
      (step: { if?: string }) => step.if !== "needs.prepare.outputs.skip == 'true'",
    )) {
      expect(step.if, `ASSERTION: ${name} never installs or verifies a promoted SHA`).toContain(
        "needs.prepare.outputs.skip != 'true'",
      );
    }
  }
  expect(workflow.jobs.test_web.strategy.matrix.shard).toEqual([1, 2]);
  expect(workflow.jobs.test_server.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
});

it.each([
  {
    ref: "refs/heads/kh-next",
    event: "push",
    runs: [],
    skip: false,
    api: false,
  },
  {
    ref: "refs/heads/kh-bisect/abc1234",
    event: "push",
    runs: [],
    skip: false,
    api: false,
  },
  {
    ref: "refs/pull/1/merge",
    event: "pull_request",
    runs: [],
    skip: false,
    api: false,
  },
  { ref: "refs/tags/v1.2.3", event: "push", runs: [], skip: false, api: false },
  { ref: "refs/heads/main", event: "push", runs: [], skip: false, api: true },
  {
    ref: "refs/heads/main",
    event: "push",
    runs: [
      {
        id: 7,
        head_sha: "abc",
        head_branch: "kh-next",
        event: "push",
        status: "completed",
        conclusion: "success",
      },
    ],
    skip: true,
    api: true,
  },
  ...[
    { head_branch: "kh-bisect/abc1234" },
    { head_branch: "kh-next/other" },
    { head_branch: null },
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_sha: "other" },
    { event: "pull_request" },
  ].map((override) => ({
    ref: "refs/heads/main",
    event: "push",
    runs: [
      {
        id: 7,
        head_sha: "abc",
        head_branch: "kh-next",
        event: "push",
        status: "completed",
        conclusion: "success",
        ...override,
      },
    ],
    skip: false,
    api: true,
  })),
])("CI preparation derives skip=$skip for $ref with $runs", ({ ref, event, runs, skip, api }) => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  expect(workflow.jobs.prepare, "ASSERTION: CI owns one verified-SHA projection").toBeDefined();
  const run = workflow.jobs.prepare.steps[0].run as string;
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-ci-promotion-"));
  const output = NodePath.join(directory, "output");
  const called = NodePath.join(directory, "called");
  try {
    NodeFS.writeFileSync(
      NodePath.join(directory, "runs.json"),
      JSON.stringify({ workflow_runs: runs }),
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "gh"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLED"\njq "${5}" "$RUNS"\n',
      { mode: 0o755 },
    );
    const result = NodeChildProcess.spawnSync("bash", ["-c", run], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REF: ref,
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: "abc",
        GITHUB_REPOSITORY: "zeropsio/mate",
        GITHUB_OUTPUT: output,
        CALLED: called,
        RUNS: NodePath.join(directory, "runs.json"),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      NodeFS.readFileSync(output, "utf8").trim().split("\n"),
      "ASSERTION: the real CI consumer emits the exact successful kh-next verdict",
    ).toEqual([`skip=${skip}`]);
    expect(NodeFS.existsSync(called)).toBe(api);
    if (api)
      expect(NodeFS.readFileSync(called, "utf8")).toContain(
        "actions/workflows/ci.yml/runs?head_sha=abc&status=success&per_page=100",
      );
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

it("tag release CI retains final verification with the preparation job's read permissions", () => {
  const release = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
  );
  expect(release.on.push.tags).toEqual(["v[0-9]+.[0-9]+.[0-9]+"]);
  expect(release.jobs.ci.uses).toBe("./.github/workflows/ci.yml");
  expect(release.jobs.ci.permissions).toMatchObject({
    actions: "read",
    contents: "read",
    "pull-requests": "read",
  });
  expect(release.jobs.release.needs).toEqual(["build", "ci"]);
});
