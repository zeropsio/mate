// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- writes Vitest evidence for Signal classification.
import * as NodeFS from "node:fs";
import type { Reporter } from "vite-plus/test/node";

/** Test failures are evidence; setup, collection and unhandled errors break the workflow. */
export default class SignalReporter implements Reporter {
  // Classify's rerun selects only the failed tests; the cases its name filter leaves out are
  // deselected, not omitted, and the classifier itself checks that each selected one ran.
  private namePattern: RegExp | undefined;

  onInit(vitest: { config: { testNamePattern?: RegExp | undefined } }): void {
    this.namePattern = vitest.config.testNamePattern;
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
