// @effect-diagnostics nodeBuiltinImport:off -- verifies the classifier CLI and its artifacts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { scenarioDurations } from "./lib/scenario-durations.ts";
import {
  classifyFailures,
  failedSelection,
  signalShardFiles,
  standingReds,
  validateReport,
  type SignalFailure,
  type SignalReport,
} from "./signal.ts";

const report = (status: string): SignalReport => ({
  tests: [
    {
      file: "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts",
      title: "Chat send",
      path: ["Chat", "send"],
      status,
    },
  ],
  errors: [],
});

it.each([
  ["failed", "fail-fail"],
  ["passed", "fail-pass"],
])("Signal classifies each original failure on the same commit: %s", (status, classification) => {
  expect(classifyFailures([report("failed")], report(status), 42)).toEqual([
    { file: report(status).tests[0]!.file, title: "Chat send", class: classification, run: 42 },
  ]);
});

it("Signal reruns only failed files once and excludes new rerun failures from classification", () => {
  const initial = {
    tests: [
      ...report("failed").tests,
      { file: "other.scenario.ts", title: "other", path: ["other"], status: "passed" },
    ],
    errors: [],
  };
  expect(failedSelection([initial, report("failed")]).files).toEqual([
    report("failed").tests[0]!.file,
  ]);
  expect(
    classifyFailures(
      [initial],
      {
        tests: [
          ...report("passed").tests,
          { file: "other.scenario.ts", title: "other", path: ["other"], status: "failed" },
        ],
        errors: [],
      },
      42,
    ),
  ).toHaveLength(1);
});

const test = (file: string, path: string[], status: string) => ({
  file,
  title: path.join(" "),
  path,
  status,
});

it("Decision: Signal reruns assertion failures only and reports time-bound failures as timed out, not rerun", () => {
  const initial: SignalReport = {
    tests: [
      test("assertion.scenario.ts", ["assertion"], "failed"),
      {
        ...test("hung.scenario.ts", ["hung"], "failed"),
        reason: "hung: no end within 180000 ms; last step: when.menu.opensMate",
      },
      {
        ...test("killed.scenario.ts", ["killed"], "failed"),
        reason: "hung: the shard ended while this case was running",
      },
    ],
    errors: [],
  };
  expect(failedSelection([initial])).toEqual({
    files: ["assertion.scenario.ts"],
    testNamePattern: "^(?:assertion)$",
  });
  expect(
    classifyFailures(
      [initial],
      { tests: [test("assertion.scenario.ts", ["assertion"], "passed")], errors: [] },
      42,
    ),
  ).toEqual([
    { file: "assertion.scenario.ts", title: "assertion", class: "fail-pass", run: 42 },
    ...initial.tests
      .slice(1)
      .map(({ file, title, reason }) => ({ file, title, reason, class: "timed-out", run: 42 })),
  ]);
  expect(failedSelection([{ ...initial, tests: initial.tests.slice(1) }]).files).toEqual([]);
});

it.each([
  { name: "Chat > send", reruns: true },
  { name: "Chat > send (plain)", reruns: true },
  { name: "Chat > send (plain) > retry", reruns: false },
  { name: "Chat > send twice", reruns: false },
  { name: "Chat > keep", reruns: false },
  { name: "Other > keep", reruns: false },
])(
  "Signal reruns only the failed tests of each failed file, not the whole file: $name",
  ({ name, reruns }) => {
    const selection = failedSelection([
      {
        tests: [
          test("chat.scenario.ts", ["Chat", "send"], "failed"),
          test("chat.scenario.ts", ["Chat", "send (plain)"], "failed"),
          test("chat.scenario.ts", ["Chat", "keep"], "passed"),
          test("other.scenario.ts", ["Other", "keep"], "passed"),
        ],
        errors: [],
      },
    ]);
    expect(selection.files).toEqual(["chat.scenario.ts"]);
    expect(new RegExp(selection.testNamePattern).test(name)).toBe(reruns);
  },
);

it.each([
  { tests: [], errors: [] },
  { ...report("failed"), errors: ["setup failed"] },
])("Signal fails when its workflow breaks rather than hiding missing test evidence: %j", (broken) =>
  expect(() => validateReport(broken)).toThrow(),
);

it.each(["skipped", "pending"])("Signal never calls an unexecuted rerun a pass: %s", (status) => {
  expect(() => classifyFailures([report("failed")], report(status), 42)).toThrow();
  expect(() => classifyFailures([report("failed")], { tests: [], errors: [] }, 42)).toThrow();
});

const failure = (title: string, kind: SignalFailure["class"], run: number): SignalFailure => ({
  file: "apps/web/test/scenarios/areas/h-budget/bundle.scenario.ts",
  title,
  class: kind,
  run,
});

it.each([
  {
    case: "fail-fail on both runs",
    previous: [failure("H > bundle", "fail-fail", 1)],
    current: [failure("H > bundle", "fail-fail", 2)],
    standing: ["H > bundle"],
  },
  {
    case: "fail-pass before",
    previous: [failure("H > bundle", "fail-pass", 1)],
    current: [failure("H > bundle", "fail-fail", 2)],
    standing: [],
  },
  {
    case: "fail-pass now",
    previous: [failure("H > bundle", "fail-fail", 1)],
    current: [failure("H > bundle", "fail-pass", 2)],
    standing: [],
  },
  {
    case: "another title before",
    previous: [failure("H > budgets", "fail-fail", 1)],
    current: [failure("H > bundle", "fail-fail", 2)],
    standing: [],
  },
  {
    case: "no previous run",
    previous: [],
    current: [failure("H > bundle", "fail-fail", 2)],
    standing: [],
  },
])(
  "Signal fails when the same test fails twice on two consecutive kh-next runs: $case",
  ({ previous, current, standing }) => {
    expect(standingReds(previous, current).map((red) => red.title)).toEqual(standing);
  },
);

it.each([
  { evidence: "no report", reason: "no report or progress" },
  { evidence: "global setup", reason: "scenario bundle artifact mismatch" },
  { evidence: "timeout stop", reason: "Scenario did not certify execution: remaining case" },
])(
  "Decision: A shard whose global setup failed is classified as infrastructure by the classifier, never a throw that hides the verdict. ($evidence)",
  ({ evidence, reason }) => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "signal-classify-"));
    try {
      for (const shard of ["c-1", "c-2", "c-4", "non-c-1", "non-c-2", "non-c-3"])
        NodeFS.writeFileSync(
          NodePath.join(directory, `${shard}.json`),
          JSON.stringify(report("passed")),
        );
      if (evidence === "global setup") {
        NodeFS.writeFileSync(
          NodePath.join(directory, "c-3.json.vitest.json"),
          JSON.stringify({ testResults: [] }),
        );
        NodeFS.writeFileSync(
          NodePath.join(directory, "c-3.json.errors.json"),
          JSON.stringify([reason]),
        );
      }
      const hung = {
        ...report("failed").tests[0]!,
        reason: "hung: no end within 180000 ms; last step: given.project",
      };
      if (evidence === "timeout stop")
        NodeFS.writeFileSync(
          NodePath.join(directory, "c-3.json"),
          JSON.stringify({ tests: [hung], errors: [reason] }),
        );
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(import.meta.dirname, "signal.ts"), "classify"],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            MATE_SIGNAL_DIRECTORY: directory,
            MATE_SIGNAL_PREVIOUS: undefined,
            GITHUB_RUN_ID: "42",
          },
          timeout: 30_000,
        },
      );
      expect(
        result.stdout,
        "ASSERTION: missing shard evidence must emit an infrastructure verdict before exiting",
      ).toContain("::error title=Signal infrastructure::c-3:");
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain("Error:");
      expect(
        JSON.parse(
          NodeFS.readFileSync(NodePath.join(directory, "signal-infrastructure.json"), "utf8"),
        ),
      ).toEqual([{ shard: "c-3", reason }]);
      expect(
        JSON.parse(NodeFS.readFileSync(NodePath.join(directory, "signal-failures.json"), "utf8")),
      ).toEqual(
        evidence === "timeout stop"
          ? [
              {
                file: hung.file,
                title: hung.title,
                reason: hung.reason,
                class: "timed-out",
                run: 42,
              },
            ]
          : [],
      );
      if (evidence === "timeout stop")
        expect(result.stdout).toContain("Signal timed out, not rerun::Chat send");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("Signal's non-C shards each run their share of every non-C scenario file by measured time, never a C file", () => {
  const shards = [1, 2, 3].map((index) => signalShardFiles("non-c", index, 3));
  const files = shards.flat();
  expect(files.length).toBeGreaterThan(0);
  expect(new Set(files).size).toBe(files.length);
  expect(files.filter((file) => file.includes("/c-mate/"))).toEqual([]);
  expect(files.every((file) => file.endsWith(".scenario.ts"))).toBe(true);
  const totals = shards.map((shard) =>
    shard.reduce((sum, file) => sum + (scenarioDurations[file] ?? 1_000), 0),
  );
  const mean = totals.reduce((sum, total) => sum + total, 0) / totals.length;
  expect(Math.max(...totals) / mean).toBeLessThan(1.1);
});
