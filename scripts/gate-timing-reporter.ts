// @effect-diagnostics nodeBuiltinImport:off -- Vitest reports timings to the local gate receipt.
import * as NodeFS from "node:fs";
import type { Reporter } from "vite-plus/test/node";

export interface TimeoutRisk {
  file: string;
  test: string;
  durationMs: number;
  timeoutMs: number;
}

export default class GateTimingReporter implements Reporter {
  private readonly output: string | undefined;
  constructor(output?: string | Record<string, unknown>) {
    // Vitest passes an options object when loading a reporter from the CLI.
    this.output = typeof output === "string" ? output : process.env.MATE_GATE_TIMINGS;
  }
  onTestCaseResult(test: {
    fullName: string;
    module: { moduleId: string };
    options: { timeout: number | undefined };
    project: { config: { testTimeout: number } };
    diagnostic(): { duration: number } | undefined;
  }): void {
    if (!this.output) return;
    const durationMs = test.diagnostic()?.duration;
    const timeoutMs = test.options.timeout ?? test.project.config.testTimeout;
    if (durationMs === undefined || timeoutMs <= 0 || durationMs < timeoutMs * 0.8) return;
    const risk: TimeoutRisk = {
      file: test.module.moduleId,
      test: test.fullName,
      durationMs,
      timeoutMs,
    };
    NodeFS.appendFileSync(this.output, JSON.stringify(risk) + "\n");
  }
}
