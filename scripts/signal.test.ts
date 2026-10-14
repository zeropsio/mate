import { expect, it } from "vite-plus/test";
import { classifyFailures, failedFiles, validateReport, type SignalReport } from "./signal.ts";

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
