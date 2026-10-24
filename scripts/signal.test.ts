import { expect, it } from "vite-plus/test";
import {
  classifyFailures,
  failedFiles,
  standingReds,
  validateReport,
  type SignalFailure,
  type SignalReport,
} from "./signal.ts";

const report = (status: string): SignalReport => ({
  tests: [
    { file: "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts", title: "Chat > send", status },
  ],
  errors: [],
});

it.each([
  ["failed", "fail-fail"],
  ["passed", "fail-pass"],
])("Signal classifies each original failure on the same commit: %s", (status, classification) => {
  expect(classifyFailures([report("failed")], report(status), 42)).toEqual([
    { file: report(status).tests[0]!.file, title: "Chat > send", class: classification, run: 42 },
  ]);
});

it("Signal reruns only failed files once and excludes new rerun failures from classification", () => {
  const initial = {
    tests: [
      ...report("failed").tests,
      { file: "other.scenario.ts", title: "other", status: "passed" },
    ],
    errors: [],
  };
  expect(failedFiles([initial, report("failed")])).toEqual([report("failed").tests[0]!.file]);
  expect(
    classifyFailures(
      [initial],
      {
        tests: [
          ...report("passed").tests,
          { file: "other.scenario.ts", title: "other", status: "failed" },
        ],
        errors: [],
      },
      42,
    ),
  ).toHaveLength(1);
});

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
