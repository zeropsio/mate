/**
 * A platform operation's docked bar, in one model for every kind the card
 * docks — a stand-up, an import, a deploy: a label that names the operation
 * (never a list of hosts that truncates), a segment per service, words that
 * say its state once, and, opened, a plain line per service: its state, the
 * step it is on, or — failed — why. "Failed" never stands alone: the reason
 * lives on the failed service's line.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { BarTone } from "./StatusBar";

export type OperationLineState = "waits" | "building" | "up" | "failed";

/** A service under an operation: its state and, failed, why — when anything says. */
export interface OperationLine {
  readonly host: string;
  readonly state: OperationLineState;
  readonly reason?: string;
}

const STEP_LINE: Record<ZeropsOperation["steps"][number]["state"], OperationLineState> = {
  queued: "waits",
  running: "building",
  done: "up",
  failed: "failed",
};

/**
 * An import's services, a line each, in the order it named them. A failed
 * one's reason is the tool's own (its step's note), else the platform's (its
 * process, `reasons` by host), else the call's error when it failed alone.
 */
export function importLines(
  operation: ZeropsOperation,
  reasons: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<OperationLine> {
  const failed = operation.steps.filter((step) => step.state === "failed").length;
  return operation.steps.map((step): OperationLine => {
    const state = STEP_LINE[step.state];
    if (state !== "failed") return { host: step.label, state };
    const reason =
      step.note ??
      reasons.get(step.label) ??
      (failed === 1 ? operation.explanation?.reason : undefined);
    return reason === undefined
      ? { host: step.label, state }
      : { host: step.label, state, reason: firstLine(reason) };
  });
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

/**
 * What names the operation on its bar: the half a stand-up stands up, an
 * import and how many services it creates, a deploy and its service.
 */
export function operationSubject(operation: ZeropsOperation): string {
  switch (operation.kind) {
    case "standup":
      return operation.subject === "stage" ? "Stage" : "Development";
    case "import": {
      const count = operation.steps.length;
      if (count === 1) return `Import · ${operation.steps[0]?.label ?? ""}`;
      return count === 0 ? "Import" : `Import · ${count} services`;
    }
    case "deploy":
      return `Deploy · ${operation.target?.hostname ?? operation.subject}`;
    default:
      return operation.subject;
  }
}

/**
 * The bar's words once its lines say how it went, saying the state once:
 * all failed, "Failed" — the label names what; some, "1 of 2 failed"; none,
 * its own word ("Imported"). Null while it runs: its step says it then.
 */
export function settledOperationWords(
  operation: ZeropsOperation,
  lines: ReadonlyArray<OperationLine>,
): string | null {
  if (operation.phase === "running") return null;
  const failed = lines.filter((line) => line.state === "failed").length;
  if (failed === 0) return operation.statusWord;
  return failed === lines.length ? "Failed" : `${failed} of ${lines.length} failed`;
}

const LINE_SEGMENT: Record<OperationLineState, BarTone> = {
  waits: "waiting",
  building: "running",
  up: "done",
  failed: "failed",
};

/** A segment per service, in its state's tone. */
export function lineSegments(
  lines: ReadonlyArray<OperationLine>,
): ReadonlyArray<{ readonly key: string; readonly tone: BarTone }> {
  return lines.length === 0
    ? [{ key: "whole", tone: "running" }]
    : lines.map((line) => ({ key: line.host, tone: LINE_SEGMENT[line.state] }));
}

const LINE_WORD: Record<
  OperationLineState,
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  waits: { tone: "off", word: "Queued" },
  building: { tone: "busy", word: "Creating" },
  up: { tone: "ok", word: "Created" },
  failed: { tone: "failed", word: "Failed" },
};

/** A service's line, opened: its state's mark and word — failed, the reason when known. */
export function operationLineWord(line: OperationLine): {
  readonly tone: ServiceStatusToneId;
  readonly word: string;
} {
  const { tone, word } = LINE_WORD[line.state];
  return { tone, word: line.state === "failed" ? (line.reason ?? word) : word };
}

/**
 * The platform's reasons for an operation's failed services, by host: the
 * reason on the latest failed process that names each service — of the
 * operation's own processes (`processIds`) when it knows them.
 */
export function processReasons(
  processes: ReadonlyArray<ActivityProcess>,
  serviceIds: ReadonlyMap<string, string>,
  processIds?: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const own = processIds === undefined ? null : new Set(processIds);
  const reasons = new Map<string, string>();
  for (const [host, serviceId] of serviceIds) {
    const failed = processes
      .filter(
        (process) =>
          process.failReason !== undefined &&
          process.serviceStackIds.includes(serviceId) &&
          (own === null || own.has(process.id)),
      )
      .sort((left, right) => Date.parse(left.created) - Date.parse(right.created))
      .at(-1);
    if (failed?.failReason !== undefined) reasons.set(host, failed.failReason);
  }
  return reasons;
}
