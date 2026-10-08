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
    const runs = checkSteps(workflow).map((step) => step.run);
    expect(runs.indexOf("vp check")).toBeGreaterThan(-1);
    expect(runs.indexOf("vp check")).toBeLessThan(runs.indexOf("vpr typecheck"));
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
