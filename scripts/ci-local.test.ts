// @effect-diagnostics nodeBuiltinImport:off - reads the repository's own workflow file.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

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

it.each(["build", "typecheck", "tc", "test"])(
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
