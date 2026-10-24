// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- writes Vitest evidence for Signal classification.
import * as NodeFS from "node:fs";
import type { Reporter } from "vite-plus/test/node";

/** Test failures are evidence; setup, collection and unhandled errors break the workflow. */
/** One line of `<report>.progress.jsonl`: a case starting, or ending with its status. */
export type SignalProgress =
  | { event: "start"; file: string; title: string }
  | { event: "end"; file: string; title: string; status: string; reason?: string };

const TIMED_OUT = /(?:Test|Hook) timed out in (\d+)ms/u;

/** The reason a timed-out case carries: it hung, and where it stood. */
export function hungReason(message: string, lastStep: unknown): string | undefined {
  const limit = TIMED_OUT.exec(message)?.[1];
  if (limit === undefined) return undefined;
  const step = typeof lastStep === "string" ? lastStep : "before its first scenario step";
  return `hung: no end within ${limit} ms; last step: ${step}`;
}

export default class SignalReporter implements Reporter {
  // Classify's rerun selects only the failed tests; the cases its name filter leaves out are
  // deselected, not omitted, and the classifier itself checks that each selected one ran.
  private namePattern: RegExp | undefined;

  onInit(vitest: { config: { testNamePattern?: RegExp | undefined } }): void {
    this.namePattern = vitest.config.testNamePattern;
  }

  private progress(line: SignalProgress): void {
    const path = process.env.MATE_SIGNAL_REPORT;
    // Appended per case, so a shard killed mid-case still leaves every finished case and the running one.
    if (path) NodeFS.appendFileSync(`${path}.progress.jsonl`, JSON.stringify(line) + "\n");
  }

  onTestCaseReady(test: { fullName: string; module: { moduleId: string } }): void {
    this.progress({ event: "start", file: test.module.moduleId, title: test.fullName });
  }

  onTestCaseResult(test: {
    fullName: string;
    module: { moduleId: string };
    meta(): { lastStep?: unknown };
    result(): { state: string; errors?: ReadonlyArray<{ message: string }> };
  }): void {
    const { state, errors = [] } = test.result();
    const reason = errors
      .map((error) => hungReason(error.message, test.meta().lastStep))
      .find((found) => found !== undefined);
    this.progress({
      event: "end",
      file: test.module.moduleId,
      title: test.fullName,
      status: state,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  onTestRunEnd(
    modules: ReadonlyArray<{
      moduleId: string;
      errors(): ReadonlyArray<{ message: string }>;
      children: {
        allTests(): Iterable<{
          fullName: string;
          options: { fails: boolean | undefined };
          result(): { state: string };
        }>;
      };
    }>,
    errors: ReadonlyArray<{ message: string }>,
  ): void {
    const failures = [...errors, ...modules.flatMap((module) => module.errors())].map(
      (error) => error.message,
    );
    // Keep the chat gate's execution contract. A failing assertion is signal; a case that
    // never executes, or expects failure, cannot certify the promised scenario inventory.
    for (const module of modules)
      for (const test of module.children.allTests())
        if (
          (this.namePattern?.test(test.fullName) ?? true) &&
          (test.options.fails || !["passed", "failed"].includes(test.result().state))
        )
          failures.push(`Scenario did not certify execution: ${test.fullName}`);
    const path = process.env.MATE_SIGNAL_REPORT;
    if (!path) throw new Error("Signal report path is missing");
    NodeFS.writeFileSync(`${path}.errors.json`, JSON.stringify(failures));
  }
}
