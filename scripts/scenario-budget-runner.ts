// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- stops admission in the worker, before the next case starts.
import * as NodeFS from "node:fs";
import { inject, TestRunner, type RunnerTestCase } from "vite-plus/test";
import { hungReason } from "./signal-reporter.ts";
import type {} from "./scenario-budget.setup.ts";

export default class ScenarioBudgetRunner extends TestRunner {
  onAfterRetryTask(test: RunnerTestCase): void {
    const receipt = inject("scenarioTimeoutStreak");
    const timedOut =
      test.result?.state === "fail" &&
      test.result.errors?.some(
        (error) => hungReason(error.message, Reflect.get(test.meta, "lastStep")) !== undefined,
      );
    // A single receipt survives file isolation and worker replacement; no timer or per-case fixture.
    const streak = timedOut
      ? [...(JSON.parse(NodeFS.readFileSync(receipt, "utf8")) as string[]), test.name]
      : [];
    NodeFS.writeFileSync(receipt, JSON.stringify(streak));
    if (streak.length === 3) {
      console.error(`Stopped shard after 3 consecutive time-bound failures: ${streak.join("; ")}`);
      // Vitest checks bail after this hook and cancels both this worker and pending files.
      // Ordinary assertion failures leave bail off and the remaining inventory still runs.
      this.config.bail = 1;
    }
  }
}
