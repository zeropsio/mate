// @effect-diagnostics nodeBuiltinImport:off - reads the repository's own workflow file.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { parse } from "yaml";

import { checkJobIds } from "./ci-blame.ts";
import { checkSteps, selectSteps } from "./ci-local.ts";

const WORKFLOW = `
jobs:
  check:
    env:
      FORCE_COLOR: "0"
      TOKEN: \${{ secrets.TOKEN }}
    steps:
      - name: Checkout
        uses: actions/checkout@v6
      - name: Lint
        run: vp check
      - name: Only on pull requests
        if: github.event_name == 'pull_request'
        run: echo pr
      - name: Typecheck
        run: vpr typecheck
        working-directory: apps/web
        env:
          NODE_OPTIONS: --max-old-space-size=8192
      - name: Reads a context
        run: echo \${{ github.sha }}
`;

it("CI and local Check always enforce test sentence retention", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(checkSteps(workflow).map((step) => step.run)).toContain(
    "node scripts/check-test-sentences.ts",
  );
});

it("CI and local Check run the lane's standalone scenario typecheck", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(checkSteps(workflow).map((step) => step.run)).toContain(
    "vp exec tsc --noEmit --incremental -p apps/web/test/scenarios/tsconfig.json",
  );
});

describe("checkSteps", () => {
  it("runs parallel Check jobs locally in order with one install and every validation", () => {
    const workflow = `
jobs:
  check:
    steps:
      - name: Install dependencies
        run: vp install --frozen-lockfile
      - name: Check
        run: vp check
  check_guards:
    env:
      GUARD_MODE: strict
    steps:
      - name: Install dependencies
        run: vp install --frozen-lockfile
      - name: Guard
        run: node guard.ts
  check_types:
    steps:
      - name: Install dependencies
        run: vp install --frozen-lockfile
      - name: Typecheck
        run: vpr typecheck
  check_build:
    steps:
      - name: Install dependencies
        run: vp install --frozen-lockfile
      - name: Repeated validation
        run: node guard.ts
      - name: Build
        run: vp run build
  unrelated:
    steps:
      - run: echo unrelated
`;
    const steps = checkSteps(workflow);
    expect(
      steps.map((step) => step.run),
      "ASSERTION: local Check keeps every worker validation and installs only once",
    ).toEqual([
      "vp install --frozen-lockfile",
      "vp check",
      "node guard.ts",
      "vpr typecheck",
      "node guard.ts",
      "vp run build",
    ]);
    expect(steps.find((step) => step.name === "Guard")?.env).toEqual({ GUARD_MODE: "strict" });
    expect(checkSteps(workflow, "check_guards").map((step) => step.run)).toEqual([
      "vp install --frozen-lockfile",
      "node guard.ts",
    ]);
  });

  it("keeps the job's own run steps in order, each with the job's env under its own", () => {
    expect(checkSteps(WORKFLOW)).toEqual([
      { name: "Lint", run: "vp check", env: { FORCE_COLOR: "0" }, workingDirectory: undefined },
      {
        name: "Typecheck",
        run: "vpr typecheck",
        env: { FORCE_COLOR: "0", NODE_OPTIONS: "--max-old-space-size=8192" },
        workingDirectory: "apps/web",
      },
    ]);
  });

  it("names the job it cannot find", () => {
    expect(() => checkSteps(WORKFLOW, "deploy")).toThrow('no job "deploy"');
  });

  it("reads the repository's own Check job, the repo-wide check before the typecheck", () => {
    const workflow = NodeFS.readFileSync(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    const steps = checkSteps(workflow);
    const check = steps.findIndex((step) => step.name === "Check");
    const typecheck = steps.findIndex((step) => step.name === "Typecheck");
    expect(check).toBeGreaterThan(-1);
    expect(steps[check]?.run).toContain("vp check");
    expect(check).toBeLessThan(typecheck);
  });
});

describe("selectSteps", () => {
  const steps = checkSteps(WORKFLOW);

  it.each([
    { words: [], names: ["Lint", "Typecheck"] },
    { words: ["type"], names: ["Typecheck"] },
    { words: ["LINT", "type"], names: ["Lint", "Typecheck"] },
    { words: ["nothing"], names: [] },
  ])("$words keeps $names", ({ words, names }) => {
    expect(selectSteps(steps, words).map((step) => step.name)).toEqual(names);
  });
});

it("Decision: local Check defers desktop and mobile steps during the hosted web test phase", () => {
  const workflow = `
jobs:
  check:
    steps:
      - name: Check generated mobile themes
        run: vp run --filter @t3tools/mobile generate -- --check
      - name: Ensure Electron runtime is installed
        run: vp run --filter @t3tools/desktop ensure:electron
      - name: Mobile native analysis
        run: node scripts/mobile-native-static-check.ts
        working-directory: apps/mobile
      - name: Web
        run: vp check
`;
  expect(
    checkSteps(workflow).map((step) => step.name),
    "ASSERTION: local Check runs hosted web work without deferred client setup",
  ).toEqual(["Web"]);
});

it.each(["test"])(
  "Decision: the default %s task excludes desktop and mobile during the test phase",
  (task) => {
    const manifest = JSON.parse(
      NodeFS.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts[task]).toContain("--filter '!@t3tools/mobile'");
    expect(manifest.scripts[task]).toContain("--filter '!@t3tools/desktop'");
  },
);

it("Decision: desktop and mobile source is kept during the hosted web test phase", () => {
  for (const client of ["desktop", "mobile"]) {
    const source = new URL(`../apps/${client}/src/`, import.meta.url);
    expect(NodeFS.readdirSync(source).length).toBeGreaterThan(0);
  }
});

it.each(["build", "typecheck", "tc"])(
  "Decision: the default %s task keeps desktop and mobile compiling during the test phase",
  (task) => {
    const manifest = JSON.parse(
      NodeFS.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(
      manifest.scripts[task],
      "ASSERTION: default typechecking includes native clients",
    ).not.toContain("!@t3tools/mobile");
    expect(manifest.scripts[task]).not.toContain("!@t3tools/desktop");
  },
);

it.each(["true", "false"])(
  "Decision: no app is outside the gate; native unit tests are discoverable locally and on GitHub Actions (GITHUB_ACTIONS=%s)",
  (githubActions) => {
    const result = NodeChildProcess.spawnSync(
      "vp",
      ["test", "list", "apps/mobile", "apps/desktop", "--filesOnly", "--passWithNoTests"],
      {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: githubActions },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const files = result.stdout
      .split("\n")
      .filter((line) => /^apps\/(?:mobile|desktop)\//u.test(line));
    expect(
      files,
      "ASSERTION: every environment discovers the existing mobile unit consumer",
    ).toContain("apps/mobile/src/state/workspaceModel.test.ts");
    expect(files).toContain("apps/desktop/scripts/smoke-test.test.mjs");
  },
);

it("Decision: CI keeps native compilation, mobile units, desktop smoke and mobile static analysis during the hosted web test phase", () => {
  const workflow = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  const runs = (job: string) =>
    workflow.jobs[job]?.steps?.flatMap((step) => (step.run === undefined ? [] : [step.run])) ?? [];
  expect(checkJobIds.flatMap(runs)).toContain("vpr typecheck");
  expect(runs("test_mobile"), "ASSERTION: CI still runs the native mobile unit task").toContain(
    "vp run --filter @t3tools/mobile test",
  );
  expect(runs("test_packages").some((run) => run.includes("vp run build:desktop"))).toBe(true);
  expect(
    runs("test_packages").some((run) =>
      run.includes("vp run --filter @t3tools/desktop smoke-test"),
    ),
  ).toBe(true);
  expect(runs("mobile_native_static_analysis")).toContain("vp run lint:mobile");
  const packageTests = runs("test_packages").find((run) => run.includes("vp run --parallel"));
  expect(packageTests).toBeDefined();
  expect(packageTests).not.toContain("!@t3tools/desktop");
  expect(runs("test_packages")).toContain("vp run --filter @t3tools/desktop ensure:electron");
});

it("local Check always verifies work even when CI can skip a promoted SHA", () => {
  const workflow = `jobs:
  check:
    steps:
      - name: Verified promotion
        if: needs.prepare.outputs.skip == 'true'
        run: echo verified
      - name: Check
        if: needs.prepare.outputs.skip != 'true'
        run: vp check
`;
  expect(
    checkSteps(workflow).map((step) => step.run),
    "ASSERTION: local verification cannot disappear behind CI promotion",
  ).toEqual(["vp check"]);
});

it("local Check leaves runner output projection to GitHub", () => {
  const workflow = `jobs:
  check:
    steps:
      - name: Resolve store path
        run: echo store=path >> "$GITHUB_OUTPUT"
      - name: Alternate output syntax
        run: echo store=path >> "\${GITHUB_OUTPUT}"
      - name: Verify workflow
        run: echo checked
`;
  expect(
    checkSteps(workflow).map((step) => step.name),
    "ASSERTION: local checks cannot write GitHub runner outputs",
  ).toEqual(["Verify workflow"]);
});
