/**
 * A platform operation's docked bar, in one model for every kind the card
 * docks — a stand-up, an import, a deploy: a label that names the operation
 * (never a list of hosts that truncates), a segment per service, words that
 * say its state once, and, opened, a plain line per service: its state, the
 * step it is on, or — failed — why. "Failed" never stands alone: the reason
 * lives on the failed service's line.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type {
  PipelineReadout,
  PipelineSpokenState,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import { standupStepRole, type ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import { drawnSteps } from "../zerops/operation/drawnSteps";
import { splitBatchDeploy } from "./conversation.logic";
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

/**
 * A settled operation's bar in the chat, from what it knew of its steps: it
 * carries what the call found, not only that the call ran. A step that found
 * something wrong — a check that did not pass, from a call that itself went
 * through — amber; a call that failed cut where it failed, red while that
 * still stands and quiet once a later one undid it (K9). Its segments are its
 * services where they mean services — a batch, an import, a mount, a
 * stand-up, a check of every service — and kept however they went. In the
 * log, empty — no bar — where it would say nothing its mark, its words and
 * its time do not: one segment, or every one only done (pass 43). In the live
 * slot it keeps the bar it wore while it ran, so nothing beside it moves as
 * it settles; the rule applies once it stands in the log.
 */
export function settledOperationBar(
  operation: ZeropsOperation,
  undone: boolean,
  where: "slot" | "log" = "log",
): ReadonlyArray<{ readonly key: string; readonly tone: BarTone }> {
  const failed = operation.phase === "failed";
  const cut: BarTone = undone ? "waiting" : "failed";
  // A stage a stand-up queued or held back is no segment of this call.
  const steps =
    operation.kind === "standup"
      ? operation.steps.filter((step) => standupStepRole(step) === "own")
      : operation.steps;
  if (steps.length === 0)
    return where === "slot" ? [{ key: "whole", tone: failed ? cut : "done" }] : [];
  if (steps.length < 2 && where === "log") return [];
  const segments = steps.map((step): { readonly key: string; readonly tone: BarTone } => ({
    key: step.id,
    tone: failed
      ? step.state === "done"
        ? "done"
        : step.state === "failed" || step.state === "running"
          ? cut
          : "waiting"
      : step.state === "failed"
        ? undone
          ? "waiting"
          : "attention"
        : "done",
  }));
  if (where === "slot" || segmentsAreServices(operation)) return segments;
  return segments.every((segment) => segment.tone === "done") ? [] : segments;
}

/** Whether an operation's steps are its services: a batch, an import, a mount, a stand-up, a check of every service. */
function segmentsAreServices(operation: ZeropsOperation): boolean {
  switch (operation.kind) {
    case "deploy":
      return operation.batch === true;
    case "import":
    case "mount":
    case "standup":
      return true;
    case "verify":
      return operation.subject === "all services";
    default:
      return false;
  }
}

/** A pipeline step's state as its segment's tone. */
export const PIPELINE_BAR: Record<PipelineSpokenState, BarTone> = {
  finished: "done",
  running: "running",
  activating: "running",
  failed: "failed",
  waiting: "waiting",
  cancelled: "waiting",
};

/** A pipeline whose steps the platform has listed. */
function listed(pipeline: PipelineReadout): boolean {
  return !pipeline.calculating && pipeline.steps.length > 0;
}

/**
 * A running operation's bar in the live slot: a segment per step in its
 * state's tone, one running segment while it names none, and the step it is
 * on in words — "Build", as the Zerops GUI names it, or the sentence of the
 * step that failed. A deploy's pipeline, read
 * off the platform (`pipeline`), stands for the steps its call reserved.
 */
export function liveOperationBar(
  operation: ZeropsOperation,
  pipeline?: PipelineReadout,
): {
  readonly segments: ReadonlyArray<{ readonly key: string; readonly tone: BarTone }>;
  readonly word: string | null;
} {
  if (pipeline !== undefined && listed(pipeline)) {
    const now =
      pipeline.steps.find((step) => step.id === pipeline.currentStepId) ??
      pipeline.steps.find((step) => PIPELINE_BAR[step.state] === "running") ??
      null;
    return {
      segments: pipeline.steps.map((step) => ({ key: step.id, tone: PIPELINE_BAR[step.state] })),
      // A step that failed is named with how it ended, never as if it ran on.
      word: now === null ? null : now.state === "failed" ? now.sentence : now.label,
    };
  }
  const steps =
    operation.kind === "standup"
      ? operation.steps.filter((step) => standupStepRole(step) === "own")
      : operation.steps;
  const calculating = pipeline?.calculating === true ? "Calculating steps" : null;
  if (steps.length === 0) {
    return { segments: [{ key: "whole", tone: "running" }], word: calculating };
  }
  const now =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed") ??
    null;
  return {
    segments: steps.map((step) => ({
      key: step.id,
      tone:
        step.state === "done"
          ? "done"
          : step.state === "running"
            ? "running"
            : step.state === "failed"
              ? "failed"
              : "waiting",
    })),
    word: calculating ?? (now === null ? null : now.stateLabel || now.label),
  };
}

/**
 * What an operation's card read of the platform (`useOperationCard`'s
 * observed region), counted: its pipeline's steps or its own, the processes
 * beside it, and whether it has a build log. Null while it read nothing.
 */
export interface ObservedLines {
  readonly steps: number;
  readonly chips: number;
  readonly log: boolean;
}

export function observedLinesOf(
  observed:
    | {
        readonly steps: ReadonlyArray<unknown>;
        readonly chips?: ReadonlyArray<unknown>;
        readonly pipeline?: PipelineReadout;
        readonly log?: unknown;
      }
    | undefined,
): ObservedLines | null {
  if (observed === undefined) return null;
  return {
    steps:
      observed.pipeline !== undefined && listed(observed.pipeline)
        ? observed.pipeline.steps.length
        : observed.steps.length,
    chips: observed.chips?.length ?? 0,
    log: observed.log !== undefined && observed.log !== null,
  };
}

/**
 * Whether the live slot draws an operation open onto its card: once the card
 * read its pipeline's steps or its build log — while it runs, and as it ended
 * there, so it lands in the history as it stood. The processes beside it
 * alone never open it: they may not be read once its call settled.
 */
export function showsCardInSlot(observed: ObservedLines | null): boolean {
  return observed !== null && (observed.steps > 0 || observed.log);
}

/**
 * How much an operation opens to (`opensOnto`, the owner's colleague, 2026-10-01:
 * "you don't need an arrow if it doesn't show anything"): a stand-up's
 * services, an import's, else the parts its own card draws — its steps, a
 * reason and its log, the version whose pipeline and log it reads, its links,
 * what a read returned, a check's picture or what it read of the page — and
 * what its card read of the platform (`observed`): a running deploy's
 * pipeline and build log. None: a deploy with no steps and no log yet opens
 * onto nothing.
 */
export function detailLines(
  operation: ZeropsOperation,
  standupRows: number | null,
  observed: ObservedLines | null = null,
  /** A dev server's address, as the topology knows it: its card draws the way to it (`devServerUrlFor`). */
  devServerUrl: string | undefined = undefined,
): number {
  if (operation.kind === "standup") return standupRows ?? 0;
  if (operation.kind === "import") return Math.max(operation.steps.length, observed?.steps ?? 0);
  // A read's card draws what it returned in place of its steps and its reason.
  if (operation.readResult !== undefined) {
    return returnedLines(operation.readResult, operation.steps) + operation.links.length;
  }
  // A result-line kind's one step is drawn only when it failed (`drawnSteps`).
  const own = drawnSteps(operation, operation.steps).length;
  // What it read of the platform stands for the steps its call reserved.
  const drawn =
    observed === null
      ? own
      : (observed.steps > 0 ? observed.steps : own) + observed.chips + (observed.log ? 1 : 0);
  const openLink = operation.kind === "devServer" && devServerUrl !== undefined ? 1 : 0;
  return (
    drawn +
    operation.links.length +
    openLink +
    (operation.explanation === undefined ? 0 : 1) +
    (operation.restartProcess === undefined ? 0 : 1) +
    (operation.version === undefined ? 0 : 1) +
    (operation.screenshot === undefined ? 0 : 1) +
    (operation.browserRead === undefined ? 0 : 1)
  );
}

/** What a read's card draws of what it returned: a log's lines and its note, a row each, a process each. */
function returnedLines(
  read: NonNullable<ZeropsOperation["readResult"]>,
  steps: ZeropsOperation["steps"],
): number {
  if (read.pending) return 0;
  switch (read.kind) {
    case "logs":
      return read.lines.length + (read.counts === undefined && read.note === undefined ? 0 : 1);
    case "events":
      return read.rows.length + (read.more === undefined ? 0 : 1);
    case "discover":
      return read.rows.length;
    case "process":
      return steps.length;
  }
}

/**
 * The line of the one deploy that stands open on its card in the live slot:
 * the newest running one, else, none running, the newest as it ended there —
 * the others stay a line each, so the slot never outgrows its room. The one
 * standing open (`held`) keeps standing until it plops: one that ended first
 * gives way only once it left the slot, a running one only to a newer one
 * running. A batch is one line, like any call.
 */
export function slotOpenDeployLine(
  lines: ReadonlyArray<{ readonly key: string; readonly operation: ZeropsOperation }>,
  held: string | null = null,
): string | null {
  const deploys = lines.filter((line) => line.operation.kind === "deploy");
  const newestRunning = deploys.findLast((line) => line.operation.phase === "running");
  const standing = deploys.find((line) => line.key === held);
  if (
    standing !== undefined &&
    (standing.operation.phase !== "running" || newestRunning === standing)
  ) {
    return standing.key;
  }
  return (newestRunning ?? deploys.at(-1))?.key ?? null;
}

/** What a batch deploy's card draws: the service it shows, as a deploy of its own; any other operation as it is. */
export function cardOperationOf(
  operation: ZeropsOperation,
  service: string | undefined,
): ZeropsOperation {
  if (operation.batch !== true || service === undefined) return operation;
  return splitBatchDeploy(operation).find((one) => one.subject === service) ?? operation;
}
