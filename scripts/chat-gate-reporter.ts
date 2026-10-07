import type { Reporter, TestModule } from "vite-plus/test/node";

/** Every boundary case must actually pass; expected failures and omissions cannot certify a port. */
export default class ChatGateReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const tests = modules.flatMap((module) => [...module.children.allTests()]);
    const uncertified = tests.filter(
      (test) => test.options.fails || test.result().state !== "passed",
    );
    if (tests.length === 0 || uncertified.length > 0)
      throw new Error(
        `Chat contract gate requires passing cases: ${uncertified.map((test) => test.fullName).join(", ") || "no cases ran"}`,
      );
  }
}
