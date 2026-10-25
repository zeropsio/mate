import { expect, it } from "vite-plus/test";
import {
  classifyFailures,
  failedSelection,
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
