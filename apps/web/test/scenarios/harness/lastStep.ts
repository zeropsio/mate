// @effect-diagnostics anyUnknownInErrorContext:off nodeBuiltinImport:off -- preserves arbitrary Effects and writes completed phase evidence.
import * as NodeFS from "node:fs";
import { TestRunner } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { scenarioMonotonicTime } from "./clientClock.ts";

/**
 * Notes the scenario step the running case entered last; a no-op outside a test. The Signal
 * reporter reads the test meta's `lastStep` to name where a hung case stood.
 */
export function recordStep(step: string): void {
  const test = TestRunner.getCurrentTest();
  if (test) Reflect.set(test.meta, "lastStep", step);
}

/** Totals are the time spent in each measured execution, which may overlap. */
export function recordPhaseDuration(phase: string, durationMs: number): void {
  const test = TestRunner.getCurrentTest();
  if (!test) return;
  const timings = (Reflect.get(test.meta, "phaseTimings") ?? {}) as Record<string, number>;
  timings[phase] = (timings[phase] ?? 0) + durationMs;
  Reflect.set(test.meta, "phaseTimings", timings);
  const report = process.env.MATE_SIGNAL_REPORT;
  if (report)
    NodeFS.appendFileSync(
      `${report}.progress.jsonl`,
      JSON.stringify({
        event: "casePhase",
        file: test.file.filepath,
        title: test.fullTestName ?? test.name,
        sha: process.env.GITHUB_SHA ?? null,
        hqRevision: process.env.MATE_HQ_REVISION ?? null,
        phase,
        durationMs,
      }) + "\n",
    );
}

/** Measure execution, not construction, of a scenario's deferred effects and step builders. */
function trackExecution(step: string, value: unknown): unknown {
  if (!process.env.MATE_SIGNAL_REPORT) return value;
  if (isPlain(value)) return trackSteps(step, value);
  if (!Effect.isEffect(value)) return value;
  return Effect.suspend(() => {
    recordStep(step);
    const started = scenarioMonotonicTime();
    return value.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const phase = step.split(".", 1)[0]!;
          recordPhaseDuration(phase, scenarioMonotonicTime() - started);
        }),
      ),
    );
  });
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * A DSL object whose every call, and every step value read from it, records its path as the
 * running case's last step. Plain objects nest; anything else is a step and is returned as is.
 */
export function trackSteps<T extends Record<string, unknown>>(path: string, target: T): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value: unknown = Reflect.get(object, key, receiver);
      if (typeof key !== "string") return value;
      const step = `${path}.${key}`;
      if (isPlain(value)) return trackSteps(step, value);
      if (typeof value === "function")
        return new Proxy(value, {
          apply(fn, self, args) {
            recordStep(step);
            return trackExecution(step, Reflect.apply(fn, self, args));
          },
        });
      recordStep(step);
      return trackExecution(step, value);
    },
  });
}
