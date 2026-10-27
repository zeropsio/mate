// @effect-diagnostics nodeBuiltinImport:off -- Vitest's real consumer receives reported test states.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import GateSmokeReporter from "./gate-smoke-reporter.ts";
import { stateOnlySmoke } from "./gate-changed.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const selections = Object.entries(stateOnlySmoke).flatMap(([file, titles]) =>
  titles.map((title) => ({ file, title })),
);
function module(file: string, title: string, state = "passed") {
  return {
    moduleId: NodePath.join(root, file),
    children: {
      allTests: () => [{ fullName: `outer suite > ${title}`, result: () => ({ state }) }],
    },
  };
}

it.each(selections)("a stale smoke selector fails the gate: $title", ({ file, title }) => {
  const reporter = new GateSmokeReporter({ root, selections: { [file]: [title] } });
  expect(
    () => reporter.onTestRunEnd([module(file, "another case")]),
    "ASSERTION: a stale smoke selector must fail instead of shrinking coverage",
  ).toThrow(`Missing selected smoke case: ${file}: ${title}`);
  expect(() => reporter.onTestRunEnd([module(file, title)])).not.toThrow();
});

it.each(["skipped", "pending", "failed"])("a %s smoke case cannot certify coverage", (state) => {
  const { file, title } = selections[0]!;
  const reporter = new GateSmokeReporter({ root, selections: { [file]: [title] } });
  expect(() => reporter.onTestRunEnd([module(file, title, state)])).toThrow(
    "Smoke case did not pass",
  );
});

it("Decision: smoke coverage must never shrink silently.", () => {
  const { file, title } = selections[0]!;
  const reporter = new GateSmokeReporter({ root, selections: { [file]: [title] } });
  expect(() => reporter.onTestRunEnd([module("another.test.ts", title)])).toThrow(
    "Missing selected smoke case",
  );
  expect(() => reporter.onTestRunEnd([module(file, `prefix ${title}`)])).toThrow(
    "Missing selected smoke case",
  );
});

it.each([
  { title: "missing smoke witness", expectedStatus: 1 },
  { title: "shows the first error, a short tail and the complete saved log", expectedStatus: 0 },
])(
  "Vitest exits $expectedStatus for the reported smoke selection: $title",
  ({ title, expectedStatus }) => {
    const file = "scripts/gate-log.test.ts";
    const result = NodeChildProcess.spawnSync(
      "vp",
      [
        "test",
        "run",
        file,
        "--reporter",
        "default",
        "--reporter",
        "./scripts/gate-smoke-reporter.ts",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MATE_GATE_SMOKE_CASES: JSON.stringify({ [file]: [title] }) },
      },
    );
    expect(result.status, "ASSERTION: Vitest must propagate the smoke certification verdict").toBe(
      expectedStatus,
    );
    if (expectedStatus === 1)
      expect(result.stdout + result.stderr).toContain(
        `Missing selected smoke case: ${file}: ${title}`,
      );
  },
);
