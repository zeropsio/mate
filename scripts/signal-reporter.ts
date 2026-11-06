// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- writes Vitest evidence for Signal classification.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import type { Reporter, TestCase } from "vite-plus/test/node";

/** Test failures are evidence; setup, collection and unhandled errors break the workflow. */
/** One line of `<report>.progress.jsonl`: a case starting, or ending with its status. */
export type SignalProgress =
  | { event: "phase"; phase: string; durationMs: number }
  | {
      event: "casePhase";
      file: string;
      title: string;
      sha?: string | null;
      hqRevision?: string | null;
      phase: string;
      durationMs: number;
    }
  | { event: "start"; file: string; title: string; sha?: string | null; hqRevision?: string | null }
  | {
      event: "end";
      file: string;
      title: string;
      status: string;
      sha?: string | null;
      hqRevision?: string | null;
      reason?: string;
      firstError?: { message: string; stack?: string };
      timings?: { caseMs?: number; phases: Record<string, number>; scope: string };
    };

const TIMED_OUT = /(?:Test|Hook) timed out in (\d+)ms/u;
const root = NodePath.resolve(import.meta.dirname, "..");

/** Mask credential-shaped text and known secret environment values in shard output. */
export function maskSignalSecrets(text: string): string {
  let masked = text;
  for (const [key, value] of Object.entries(process.env))
    if (
      value &&
      /(?:password|passwd|secret|token|credential|api_?key|private_?key|authorization|(?:^|_)(?:pat|pass|pwd)(?:_|$))/iu.test(
        key,
      )
    )
      for (const part of value.split(/\r?\n/u))
        if (part.length >= 4) masked = masked.replaceAll(part, "••••••");
  return maskSecrets(masked);
}

/** Emit masked evidence, escaping workflow-command delimiters in the message and file. */
export function signalEvidence(title: string, message: string, file?: string): void {
  const safe = (text: string) =>
    maskSignalSecrets(text).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const property = (text: string) => safe(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
  const location = file
    ? `file=${property(NodePath.isAbsolute(file) ? NodePath.relative(root, file) : file)},`
    : "";
  process.stdout.write(`::error ${location}title=${safe(title)}::${safe(message)}\n`);
}

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

  onTestCaseReady(test: TestCase): void {
    this.progress({
      event: "start",
      file: test.module.moduleId,
      title: test.fullName,
      sha: process.env.GITHUB_SHA ?? null,
      hqRevision: process.env.MATE_HQ_REVISION ?? null,
    });
  }

  onTestCaseResult(test: TestCase): void {
    const result = test.result();
    const errors = result.state === "failed" ? result.errors : [];
    const reason = errors
      .map((error) => hungReason(error.message, Reflect.get(test.meta(), "lastStep")))
      .find((found) => found !== undefined);
    const first = errors[0];
    const duration = test.diagnostic()?.duration;
    this.progress({
      event: "end",
      file: test.module.moduleId,
      title: test.fullName,
      status: result.state,
      sha: process.env.GITHUB_SHA ?? null,
      hqRevision: process.env.MATE_HQ_REVISION ?? null,
      ...(first === undefined
        ? {}
        : {
            firstError: {
              message: maskSignalSecrets(first.message),
              ...(typeof first.stack === "string" ? { stack: maskSignalSecrets(first.stack) } : {}),
            },
          }),
      timings: {
        ...(duration === undefined ? {} : { caseMs: duration }),
        phases: (Reflect.get(test.meta(), "phaseTimings") ?? {}) as Record<string, number>,
        scope:
          "Scenario setup, cleanup and tracked DSL effect executions; phase totals may overlap.",
      },
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
    const failures = errors.map((error) => {
      signalEvidence("Signal incomplete", error.message);
      return error.message;
    });
    for (const module of modules)
      for (const error of module.errors()) {
        signalEvidence("Signal incomplete", error.message, module.moduleId);
        failures.push(error.message);
      }
    // Keep the chat gate's execution contract. A failing assertion is signal; a case that
    // never executes, or expects failure, cannot certify the promised scenario inventory.
    for (const module of modules)
      for (const test of module.children.allTests())
        if (
          (this.namePattern?.test(test.fullName) ?? true) &&
          (test.options.fails || !["passed", "failed"].includes(test.result().state))
        ) {
          const message = `Scenario did not certify execution: ${test.fullName}`;
          signalEvidence("Signal incomplete", message, module.moduleId);
          failures.push(message);
        }
    const path = process.env.MATE_SIGNAL_REPORT;
    if (!path) throw new Error("Signal report path is missing");
    NodeFS.writeFileSync(`${path}.errors.json`, JSON.stringify(failures));
  }
}
