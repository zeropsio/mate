// @effect-diagnostics nodeBuiltinImport:off -- exercises the reporter with Vitest's reported states.
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import ChatGateReporter from "./chat-gate-reporter.ts";
import { chatGateStages, chatGateTestFiles } from "./chat-gate.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
function module(file: string, state: string, fails = false) {
  return {
    moduleId: NodePath.join(root, file),
    children: {
      allTests: () => [
        { fullName: "reported case", options: { fails }, result: () => ({ state }) },
      ],
    },
  };
}

it("Test Server certifies the same A/E/F cases as local ports while platform tests retain their own conditions", () => {
  const reporter = new ChatGateReporter({ server: true });
  expect(
    () =>
      reporter.onTestRunEnd([
        module("apps/server/src/spi/replay/goldens.test.ts", "passed"),
        module("apps/server/src/process/externalLauncher.test.ts", "skipped"),
      ]),
    "ASSERTION: strict certification is scoped to A/E/F, not platform-specific server skips",
  ).not.toThrow();
  expect(() =>
    reporter.onTestRunEnd([module("apps/server/src/process/externalLauncher.test.ts", "skipped")]),
  ).not.toThrow();
  const files = chatGateTestFiles(
    root,
    chatGateStages.filter((stage) => ["A", "E", "F"].includes(stage.id)),
  ).filter((file) => file.startsWith("apps/server/"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(
      () => reporter.onTestRunEnd([module(file, "skipped")]),
      `ASSERTION: ${file} must remain certified`,
    ).toThrow("requires passing cases");
    expect(() => reporter.onTestRunEnd([module(file, "passed", true)])).toThrow(
      "requires passing cases",
    );
  }
});

it.each(["skipped", "pending", "failed"])(
  "strict certification refuses %s cases outside the server scope",
  (state) => {
    expect(() =>
      new ChatGateReporter({ server: false }).onTestRunEnd([
        module("apps/web/test/engine-oracle/mateHealth.oracle.test.ts", state),
      ]),
    ).toThrow("requires passing cases");
  },
);

it("strict certification refuses expected failures even when they pass", () => {
  expect(() =>
    new ChatGateReporter({ server: false }).onTestRunEnd([
      module("apps/web/test/engine-oracle/runCard.oracle.test.ts", "passed", true),
    ]),
  ).toThrow("requires passing cases");
});

it.each([false, true])("strict certification fails an empty run in server scope %s", (server) => {
  const previous = process.exitCode;
  try {
    new ChatGateReporter({ server }).onTestRunEnd([]);
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
  }
});

it("strict certification refuses a selected module with no cases", () => {
  expect(() =>
    new ChatGateReporter({ server: true }).onTestRunEnd([
      {
        moduleId: NodePath.join(root, "apps/server/src/spi/replay/goldens.test.ts"),
        children: { allTests: () => [] },
      },
    ]),
  ).toThrow("no cases ran");
});

it("Vitest's empty reporter options keep strict certification enabled", () => {
  expect(() => new ChatGateReporter({}).onTestRunEnd([module("proof.test.ts", "skipped")])).toThrow(
    "requires passing cases",
  );
});
