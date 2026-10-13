// @effect-diagnostics nodeBuiltinImport:off -- executes CI's own path selector and inspects its jobs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { expect, it } from "vite-plus/test";
import { chatGateStages } from "./chat-gate.ts";
import { checkSteps } from "./ci-local.ts";

const root = NodePath.resolve(import.meta.dirname, "..");

it.each([
  ["refs/heads/main", "push"],
  ["refs/heads/main", "workflow_dispatch"],
  ["refs/heads/kh-next", "push"],
  ["refs/pull/42/merge", "pull_request"],
  ["refs/tags/v1.0.0", "push"],
])(
  "CI verifies the frozen lockfile once in Check and keeps local installs protected",
  (ref, event) => {
    const mainPush = ref === "refs/heads/main" && event === "push";
    const workflow = parse(
      NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
    ) as {
      env?: Record<string, string>;
      jobs: Record<
        string,
        {
          env?: Record<string, string>;
          if?: string;
          steps: {
            run?: string;
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
      if (name === "cache" && !mainPush) continue;
      const installs = job.steps.filter(
        (step) =>
          (step.uses === "voidzero-dev/setup-vp@v1" && step.with?.["run-install"] !== false) ||
          step.run?.startsWith("vp install --frozen-lockfile"),
      );
      for (const step of installs) {
        const env = { ...workflow.env, ...job.env, ...step.env };
        if (name === "check") {
          expect(env.PNPM_CONFIG_TRUST_LOCKFILE).toBe(
            "${{ github.ref == 'refs/heads/main' && github.event_name == 'push' }}",
          );
          env.PNPM_CONFIG_TRUST_LOCKFILE = String(mainPush);
        }
        if (name === "cache") {
          expect(env.PNPM_CONFIG_TRUST_LOCKFILE).toBe("${{ runner.os != 'Linux' }}");
          // The Linux writer verifies; the macOS writer trusts that frozen input.
          env.PNPM_CONFIG_TRUST_LOCKFILE = "false";
        }
        consumers.push(env);
        if (env.PNPM_CONFIG_TRUST_LOCKFILE !== "true") verifying.push(name);
      }
    }
    expect(
      verifying,
      "ASSERTION: exactly one Check owns the registry-backed lockfile policy verification",
    ).toEqual([mainPush ? "cache" : "check"]);
    for (const env of consumers)
      expect(
        env.PNPM_CONFIG_FROZEN_LOCKFILE,
        "ASSERTION: CI consumers must install the frozen lockfile that Check verifies",
      ).toBe("true");
    const policy = parse(NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8"));
    expect(policy.trustLockfile ?? false).toBe(false);
    expect(policy.minimumReleaseAge ?? 1440).toBeGreaterThan(0);
  },
);

it("tagged release installs reuse CI verification while manual rehearsals verify", () => {
  const release = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
  );
  expect(release.jobs.verify.if).toBeUndefined();
  expect(release.jobs.build.needs).toBe("verify");
  const install = release.jobs.build.steps.find(
    (step: { name: string }) => step.name === "Install dependencies",
  );
  expect(install.run).toBe("vp install --frozen-lockfile");
  expect(
    install.env?.PNPM_CONFIG_TRUST_LOCKFILE,
    "ASSERTION: manual rehearsals continue to verify their lockfile after the SHA verdict",
  ).toBe("${{ github.event_name == 'push' }}");
});

it("release smoke can regenerate its fixture lockfile without inheriting frozen install settings", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const job = workflow.jobs.check;
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
      .filter(
        (step) =>
          step.run?.includes("scenarios/harness/build.ts") &&
          step.if !== "needs.prepare.outputs.skip == 'true'",
      )
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
    journeys.steps.filter(
      (step) =>
        step.run &&
        !step.run.includes("$GITHUB_OUTPUT") &&
        !step.run.startsWith("vp install ") &&
        step.if !== "needs.prepare.outputs.skip == 'true'",
    ),
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
    workflow.jobs[name].steps.find((step: { name: string }) => step.name === "Install dependencies")
      .run;
  for (const name of ["chat_bundle", "chat_scenarios", "test_hq", "test_web"]) {
    expect(
      install(name),
      "ASSERTION: hosted-only test runners must not install unused native workspaces",
    ).toBe("vp install --frozen-lockfile --filter='!@t3tools/mobile' --filter='!@t3tools/desktop'");
  }
  // Scripts executes the shipped mobile Legend List patch; server consumers read the mobile feed.
  for (const name of ["test_scripts", "test_server"]) {
    expect(
      install(name),
      "ASSERTION: cross-client suites must install the mobile dependencies their consumers read",
    ).toBe("vp install --frozen-lockfile --filter='!@t3tools/desktop'");
  }
  for (const name of ["check", "test_packages", "test_mobile"])
    expect(install(name)).toBe("vp install --frozen-lockfile");
});

it("hosted web CI retains native compilation and dedicated native jobs", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  for (const job of ["test_packages", "test_mobile", "mobile_native_static_analysis"])
    expect(
      workflow.jobs[job],
      "ASSERTION: native CI jobs remain covered during the hosted web test phase",
    ).toBeDefined();
  expect(Object.keys(workflow.jobs.changes.outputs).sort()).toEqual(["chat", "resource_monitor"]);
  expect(
    workflow.jobs.check.steps.find(
      (step: { name: string }) => step.name === "Test resource monitor",
    ),
  ).toBeDefined();
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
  expect(workflow.on.workflow_call).toBeUndefined();
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
  expect(
    workflow.jobs.check.steps.find(
      (step: { name: string }) => step.name === "Test resource monitor",
    ).if,
  ).toContain("needs.changes.outputs.resource_monitor != 'false'");
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
  expect(
    Object.values(release.jobs).filter((job) =>
      (job as { uses?: string }).uses?.includes("ci.yml"),
    ),
    "ASSERTION: a release must reuse the CI verdict without starting CI jobs",
  ).toEqual([]);
  expect(release.jobs.verify.permissions).toEqual({ actions: "read", contents: "read" });
  expect(release.jobs.verify.if).toBeUndefined();
  expect(release.jobs.verify["timeout-minutes"]).toBe(2);
  expect(release.on.workflow_dispatch.inputs.version.required).toBe(true);
  expect(release.jobs.build.needs).toBe("verify");
  expect(release.jobs.release.needs).toEqual(["build", "verify"]);
});

it.each(
  ["push", "workflow_dispatch"].flatMap((event) => {
    const green = {
      id: 7,
      name: "CI final · main",
      path: ".github/workflows/ci.yml",
      head_sha: "abc",
      head_branch: "main",
      status: "completed",
      conclusion: "success",
    };
    return [
      { event, case: "no verdict", runs: [], approved: false },
      { event, case: "main", runs: [green], approved: true },
      { event, case: "renamed CI", runs: [{ ...green, name: "CI" }], approved: true },
      { event, case: "kh-next", runs: [{ ...green, head_branch: "kh-next" }], approved: true },
      ...[
        { head_branch: "feature" },
        { head_branch: "kh-bisect/abc" },
        { head_branch: null },
        { head_sha: "other" },
        { path: ".github/workflows/other.yml" },
        { status: "in_progress" },
        { conclusion: "failure" },
      ].map((override) => ({
        event,
        case: JSON.stringify(override),
        runs: [{ ...green, ...override }],
        approved: false,
      })),
      {
        event,
        case: "green after unrelated run",
        runs: [{ ...green, path: ".github/workflows/other.yml" }, green],
        approved: true,
      },
    ];
  }),
)("release verification approves=$approved for $event: $case", ({ event, runs, approved }) => {
  const release = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
  );
  expect(
    release.jobs.verify,
    "ASSERTION: release must read a prior exact-SHA CI verdict",
  ).toBeDefined();
  const step = release.jobs.verify.steps.find(
    (step: { name: string }) => step.name === "Check exact-SHA CI verification",
  );
  expect(step.env.GH_TOKEN).toBe("${{ github.token }}");
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-release-verdict-"));
  try {
    const called = NodePath.join(directory, "called");
    NodeFS.writeFileSync(
      NodePath.join(directory, "runs.json"),
      JSON.stringify({ workflow_runs: runs }),
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "gh"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLED"\njq "${5}" "$RUNS"\n',
      { mode: 0o755 },
    );
    const result = NodeChildProcess.spawnSync("bash", ["-c", step.run], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_SHA: "abc",
        GITHUB_EVENT_NAME: event,
        GITHUB_REPOSITORY: "zeropsio/mate",
        CALLED: called,
        RUNS: NodePath.join(directory, "runs.json"),
      },
    });
    expect(
      result.status,
      "ASSERTION: a tag without a version-only parent requires its own completed successful CI on main/kh-next",
    ).toBe(approved ? 0 : 1);
    expect(NodeFS.readFileSync(called, "utf8")).toContain(
      "repos/zeropsio/mate/actions/runs?head_sha=abc&status=success&per_page=100 --paginate --jq",
    );
    if (!approved) expect(result.stderr).toContain("run CI on this commit first");
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

it.each([
  { case: "green tag SHA", green: "tag", otherFile: true, editedWhitelist: false, approved: true },
  { case: "green parent and version-only diff", green: "parent", otherFile: false, approved: true },
  {
    case: "green parent and other file",
    green: "parent",
    otherFile: true,
    editedWhitelist: false,
    approved: false,
  },
  { case: "no green CI", green: "none", otherFile: false, editedWhitelist: false, approved: false },
  {
    case: "green parent and modified release file list",
    green: "parent",
    otherFile: true,
    editedWhitelist: true,
    approved: false,
  },
])(
  "Decision: release accepts green tagged CI or green first-parent CI with only release version files changed: $case",
  ({ green, otherFile, editedWhitelist, approved }) => {
    const release = parse(
      NodeFS.readFileSync(NodePath.join(root, ".github/workflows/release.yml"), "utf8"),
    );
    const step = release.jobs.verify.steps.find(
      (step: { name: string }) => step.name === "Check exact-SHA CI verification",
    );
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-release-parent-"));
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    try {
      git("init", "--quiet", "--initial-branch=main");
      git("config", "user.name", "Release verification test");
      git("config", "user.email", "release@example.invalid");
      const files = [
        "apps/server/package.json",
        "apps/desktop/package.json",
        "apps/web/package.json",
      ];
      for (const file of files) {
        NodeFS.mkdirSync(NodePath.dirname(NodePath.join(directory, file)), { recursive: true });
        NodeFS.writeFileSync(NodePath.join(directory, file), '{"version":"1.0.0"}\n');
      }
      const whitelist = NodePath.join(
        directory,
        "packages/shared/src/versionedReleasePackages.json",
      );
      NodeFS.mkdirSync(NodePath.dirname(whitelist), { recursive: true });
      NodeFS.writeFileSync(whitelist, JSON.stringify(files));
      git("add", ".");
      git("commit", "--quiet", "-m", "verified source");
      const parent = git("rev-parse", "HEAD");
      for (const file of files)
        NodeFS.writeFileSync(NodePath.join(directory, file), '{"version":"1.0.1"}\n');
      if (otherFile) NodeFS.writeFileSync(NodePath.join(directory, "unexpected.ts"), "changed\n");
      if (editedWhitelist)
        NodeFS.writeFileSync(
          whitelist,
          JSON.stringify([
            ...files,
            "unexpected.ts",
            "packages/shared/src/versionedReleasePackages.json",
          ]),
        );
      git("add", ".");
      git("commit", "--quiet", "-m", "chore(release): mate 1.0.1");
      const tag = git("rev-parse", "HEAD");
      NodeFS.writeFileSync(
        NodePath.join(directory, "runs.json"),
        JSON.stringify({
          workflow_runs:
            green === "none"
              ? []
              : [
                  {
                    id: 7,
                    path: ".github/workflows/ci.yml",
                    head_sha: green === "tag" ? tag : parent,
                    head_branch: "main",
                    status: "completed",
                    conclusion: "success",
                  },
                ],
        }),
      );
      NodeFS.writeFileSync(
        NodePath.join(directory, "gh"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLED"\njq "${5}" "$RUNS"\n',
        { mode: 0o755 },
      );
      const result = NodeChildProcess.spawnSync("bash", ["-c", step.run], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_SHA: tag,
          GITHUB_EVENT_NAME: "push",
          GITHUB_REPOSITORY: "zeropsio/mate",
          RUNS: NodePath.join(directory, "runs.json"),
          CALLED: NodePath.join(directory, "called"),
        },
      });
      expect(
        result.status,
        `ASSERTION: a green first parent permits only the release driver's version-bump files: ${result.stderr}`,
      ).toBe(approved ? 0 : 1);
      if (approved)
        expect(result.stdout).toBe(
          `CI verified ${green === "tag" ? tag : parent} for release ${tag} (run IDs: 7).\n`,
        );
      else expect(result.stderr).toContain("run CI on this commit first");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("short Ubuntu checks share installed jobs without losing their commands or failure verdicts", () => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const check = workflow.jobs.check;
  const packages = workflow.jobs.test_packages;
  for (const job of [check, packages]) expect(job["runs-on"]).toBe("ubuntu-latest");
  expect(check.needs).toContain("changes");
  expect(check.if).toContain("!cancelled()");
  expect(check.if).not.toContain("needs.changes.result");
  expect(packages["timeout-minutes"]).toBeGreaterThanOrEqual(20);
  const diagnostic = packages.steps.find(
    (step: { name: string }) => step.name === "Diagnose Linux Electron runtime",
  );
  expect(diagnostic["continue-on-error"]).toBe(true);
  const capture = packages.steps.find(
    (step: { name: string }) => step.name === "Upload desktop smoke capture",
  );
  expect(capture.if).toBe("always()");
  expect(capture.with.name).toBe("desktop-smoke-capture");
  expect(capture.with.path).toContain("desktop-smoke-log.txt");
  expect(
    packages.steps.filter(
      (step: { name: string }) => step.name === "Ensure Electron runtime is installed",
    ),
  ).toHaveLength(1);

  for (const command of [
    "cargo fmt --manifest-path native/resource-monitor/Cargo.toml -- --check",
    "cargo test --locked --manifest-path native/resource-monitor/Cargo.toml",
    "node scripts/release-smoke.ts",
  ]) {
    const steps = check.steps.filter((step: { run?: string }) => step.run === command);
    expect(steps, `ASSERTION: Check retains ${command} once`).toHaveLength(1);
    expect(steps[0]["continue-on-error"]).toBeUndefined();
    expect(steps[0].if).toContain("needs.prepare.outputs.skip != 'true'");
    if (command.startsWith("cargo"))
      expect(steps[0].if).toContain("needs.changes.outputs.resource_monitor != 'false'");
  }
  expect(check.steps.find((step: { name: string }) => step.name === "Setup Rust").uses).toBe(
    "dtolnay/rust-toolchain@stable",
  );
  for (const name of [
    "Build desktop pipeline",
    "Verify preload bundle output",
    "Stage desktop web bundle",
    "Smoke test desktop",
    "Upload desktop smoke capture",
  ]) {
    const steps = packages.steps.filter((step: { name: string }) => step.name === name);
    expect(steps, `ASSERTION: Packages retains the named ${name} receipt`).toHaveLength(1);
    expect(steps[0]["continue-on-error"]).toBeUndefined();
  }
  expect(workflow.jobs.rust).toBeUndefined();
  expect(workflow.jobs.desktop_smoke).toBeUndefined();
  expect(workflow.jobs.release_smoke.needs).toContain("check");
  const verdict = workflow.jobs.release_smoke.steps.find(
    (step: { name: string }) => step.name === "Require release smoke to pass",
  );
  for (const result of ["success", "failure", "cancelled", "skipped"]) {
    const run = verdict.run.replace("${{ needs.check.result }}", result);
    expect(NodeChildProcess.spawnSync("bash", ["-e", "-c", run]).status).toBe(
      result === "success" ? 0 : 1,
    );
  }
  expect(
    check.steps.some(
      (step: { run?: string }) => step.run === "vp test run scripts/mate-zone-architecture.test.ts",
    ),
  ).toBe(false);
  expect(
    workflow.jobs.test_scripts.steps.some((step: { run?: string }) =>
      step.run?.includes("--filter @t3tools/scripts test"),
    ),
  ).toBe(true);
});

it.each([
  ["refs/heads/main", "push", true],
  ["refs/heads/main", "workflow_dispatch", false],
  ["refs/heads/main", "pull_request", false],
  ["refs/heads/kh-next", "push", false],
  ["refs/heads/kh-bisect/failure", "push", false],
  ["refs/pull/42/merge", "pull_request", false],
  ["refs/tags/v1.0.0", "push", false],
])("only main saves CI caches for %s", (ref, event, writes) => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const writers = Object.entries(workflow.jobs).filter(([, job]) =>
    (job as { steps?: { uses?: string }[] }).steps?.some(
      (step) => step.uses === "actions/cache/save@v4",
    ),
  );
  expect(writers, "ASSERTION: one main-only job owns all cache saves").toHaveLength(1);
  const [name, raw] = writers[0]!;
  const job = raw as {
    if: string;
    permissions: Record<string, string>;
    strategy: { matrix: { os: string[] } };
    steps: { uses?: string; with?: Record<string, unknown> }[];
  };
  expect(name).toBe("cache");
  expect(job.if).toBe("github.ref == 'refs/heads/main' && github.event_name == 'push'");
  const condition = job.if
    .replaceAll("github.ref", '"$GITHUB_REF"')
    .replaceAll("github.event_name", '"$GITHUB_EVENT_NAME"');
  const verdict = NodeChildProcess.spawnSync(
    "bash",
    ["-e", "-c", `if [[ ${condition} ]]; then printf save; else printf restore; fi`],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF: String(ref), GITHUB_EVENT_NAME: String(event) },
    },
  );
  expect(verdict.status, verdict.stderr).toBe(0);
  expect(verdict.stdout, "ASSERTION: only a main push writes caches").toBe(
    writes ? "save" : "restore",
  );
  expect(job.strategy.matrix.os).toEqual(["ubuntu-latest", "macos-latest"]);
  expect(job.permissions.actions).toBe("write");
  expect(job.steps.filter((step) => step.uses === "actions/cache/save@v4")).toHaveLength(3);
  for (const step of job.steps.filter((step) => step.uses === "voidzero-dev/setup-vp@v1"))
    expect(step.with?.cache).toBe(false);
  for (const [id, consumer] of Object.entries(workflow.jobs)) {
    if (id !== name)
      expect((consumer as { permissions?: Record<string, string> }).permissions?.actions).not.toBe(
        "write",
      );
  }
});

it.each(["ci", "release"])(
  "other refs restore registry metadata with a lockfile fallback in %s",
  (name) => {
    const workflow = parse(
      NodeFS.readFileSync(NodePath.join(root, `.github/workflows/${name}.yml`), "utf8"),
    );
    const job = workflow.jobs[name === "ci" ? "check" : "build"];
    const step = job.steps.find((step: { name?: string }) => step.name === "Restore pnpm metadata");
    expect(
      step,
      "ASSERTION: policy verification must restore pnpm's metadata cache before installing",
    ).toBeDefined();
    expect(step.uses).toBe("actions/cache/restore@v4");
    expect(step.with.key).toBe(
      "pnpm-metadata-${{ runner.os }}-pnpm11-${{ hashFiles('pnpm-lock.yaml') }}",
    );
    expect(step.with["restore-keys"].trim()).toBe("pnpm-metadata-${{ runner.os }}-pnpm11-");
    expect(
      step.with.path,
      "ASSERTION: metadata restores must exclude pnpm's hash-based verification receipt",
    ).toBe("${{ runner.temp }}/pnpm-metadata/v11");
    const install = job.steps.find(
      (step: { name?: string }) => step.name === "Install dependencies",
    );
    expect(install.env.PNPM_CONFIG_CACHE_DIR).toBe("${{ runner.temp }}/pnpm-metadata");
    expect(workflow.env.PNPM_CONFIG_FETCH_RETRIES).toBe("2");
    expect(workflow.env.PNPM_CONFIG_FETCH_TIMEOUT).toBe("60000");
    expect(job.steps.indexOf(step)).toBeLessThan(
      job.steps.findIndex((step: { name?: string }) => step.name === "Setup Vite+"),
    );
    for (const consumer of Object.values(workflow.jobs) as {
      steps?: { uses?: string; with?: Record<string, unknown> }[];
    }[]) {
      for (const setup of consumer.steps?.filter(
        (step) => step.uses === "voidzero-dev/setup-vp@v1",
      ) ?? []) {
        expect(
          setup.with?.cache,
          "ASSERTION: setup-vp must never perform an automatic post save",
        ).toBe(false);
        expect(setup.with?.["run-install"]).toBe(false);
      }
      const restore = consumer.steps?.find(
        (step) =>
          step.uses === "actions/cache/restore@v4" &&
          String(step.with?.key).startsWith("vite-plus-"),
      );
      if (consumer.steps?.some((step) => step.uses === "voidzero-dev/setup-vp@v1")) {
        expect(
          restore,
          "ASSERTION: every pnpm consumer restores the newest store on a lockfile miss",
        ).toBeDefined();
        expect(restore?.with?.["restore-keys"]).toBe(
          "vite-plus-${{ runner.os }}-${{ steps.paths.outputs.arch }}-pnpm-\n",
        );
      }
    }
  },
);

it.each([
  "vite-plus-Linux-x64-pnpm",
  "vite-plus-macOS-arm64-pnpm",
  "pnpm-metadata-Linux-pnpm11",
  "mate-test-browser-Linux",
])("prune keeps the newest main cache per prefix and OS for %s", (family) => {
  const workflow = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const step = workflow.jobs.cache?.steps.find(
    (step: { name?: string }) => step.name === "Prune superseded main caches",
  );
  expect(step, "ASSERTION: each save must prune superseded caches in the same job").toBeDefined();
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-ci-cache-"));
  const prefix = `${family}-`;
  const other = family.includes("Linux") ? "macOS" : "Linux";
  const records = [
    { id: 1, key: `${prefix}old`, ref: "refs/heads/main", created_at: "2026-10-01" },
    { id: 2, key: `${prefix}new`, ref: "refs/heads/main", created_at: "2026-10-13" },
    { id: 3, key: `${prefix}branch`, ref: "refs/heads/kh-next", created_at: "2026-10-14" },
    {
      id: 4,
      key: `${family.replace(/Linux|macOS/u, other)}-old`,
      ref: "refs/heads/main",
      created_at: "2026-10-01",
    },
    { id: 5, key: "other-prefix-old", ref: "refs/heads/main", created_at: "2026-10-01" },
  ];
  try {
    NodeFS.writeFileSync(
      NodePath.join(directory, "caches.json"),
      JSON.stringify([
        { actions_caches: records.slice(0, 2) },
        { actions_caches: records.slice(2) },
      ]),
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "gh"),
      `#!/bin/bash
if [[ "$*" == *"--method DELETE"* ]]; then echo "$*" >> "$DELETIONS"; else cat "$RECORDS"; fi
`,
      { mode: 0o755 },
    );
    for (const key of [`${prefix}new`, `${prefix}missing`]) {
      const deletions = NodePath.join(directory, "deleted");
      NodeFS.rmSync(deletions, { force: true });
      const result = NodeChildProcess.spawnSync("bash", ["-e", "-c", step.run], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_REPOSITORY: "zeropsio/mate",
          CACHE_KEYS: key,
          RECORDS: NodePath.join(directory, "caches.json"),
          DELETIONS: deletions,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(
        NodeFS.existsSync(deletions)
          ? NodeFS.readFileSync(deletions, "utf8").trim().split("\n")
          : [],
        "ASSERTION: pruning removes legacy branch copies, preserves other OS keys, and keeps all caches when save is absent",
      ).toEqual(
        key.endsWith("new")
          ? [
              "api --method DELETE repos/zeropsio/mate/actions/caches/1",
              "api --method DELETE repos/zeropsio/mate/actions/caches/3",
            ]
          : [],
      );
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

const workflowFiles = NodeFS.readdirSync(NodePath.join(root, ".github/workflows")).filter((name) =>
  /\.ya?ml$/u.test(name),
);
const actionlint = (files: string[], input?: string) =>
  NodeChildProcess.spawnSync(
    process.execPath,
    [
      NodePath.join(root, "scripts/node_modules/github-actionlint/dist/bin/actionlint.js"),
      "-shellcheck=",
      "-pyflakes=",
      ...files,
    ],
    {
      cwd: root,
      encoding: "utf8",
      input,
      timeout: 60_000,
      env: { ...process.env, ACTIONLINT_RELEASE: "1.7.12" },
    },
  );

it.each(workflowFiles)(
  "GitHub accepts the workflow schema and contexts in %s",
  (file) => {
    const result = actionlint([NodePath.join(root, ".github/workflows", file)]);
    expect(
      result.status,
      `ASSERTION: workflow must pass pinned actionlint: ${result.stdout}${result.stderr}`,
    ).toBe(0);
  },
  60_000,
);

it.each([
  { place: "workflow", yaml: "cache-mode: read\n" },
  {
    place: "job",
    yaml: "jobs:\n  check:\n    runs-on: ubuntu-latest\n    cache-mode: write\n    steps:\n      - run: echo checked\n",
  },
])("workflow validation rejects an unknown key at the $place level", ({ place, yaml }) => {
  const source =
    place === "workflow"
      ? `on: push\n${yaml}jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo checked\n`
      : `on: push\n${yaml}`;
  const result = actionlint(["-"], source);
  expect(result.status, "ASSERTION: unknown workflow keys must fail locally").toBe(1);
  expect(result.stdout).toContain(`unexpected key "cache-mode" for "${place}" section`);
});

it("CI and local Check validate every workflow with pinned actionlint", () => {
  const workflow = NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8");
  const step = checkSteps(workflow).find((step) => step.name === "Check workflow schema");
  expect(step, "ASSERTION: CI and ci-local must share workflow schema validation").toBeDefined();
  expect(step?.run).toBe(
    "vp exec github-actionlint -shellcheck= -pyflakes= ../.github/workflows/*.yml",
  );
  expect(step?.workingDirectory).toBe("scripts");
  expect(step?.env.ACTIONLINT_RELEASE).toBe("1.7.12");
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(root, "scripts/package.json"), "utf8"),
  );
  expect(manifest.devDependencies["github-actionlint"]).toBe("1.7.12");
});
