/** The single restart interpreter, shared by account projections and rendering consumers. */
import { formatDuration } from "../../zerops/activity/pipelineReadout.ts";
import type { ActivityProcess } from "../../zerops/activity/dto.ts";
import type { ReachabilityAction } from "../../zerops/environments/index.ts";
import type { ZeropsProcessOutcome } from "../../zerops/cards/payloads.ts";
import { HISTORY_PAGE, runsStill, type ProcessValue } from "../families/process.ts";
import type { OperationProgress } from "./operation.ts";

/**
 * How far before a press Zerops' `created` (its servers' clock) may stand for a process the press
 * itself caused, read against `since` (this browser's clock): the skew between a laptop and
 * Zerops. A laptop kept by network time is off by well under a second, one that missed its sync
 * for days by tens of seconds; two minutes covers that with room. Smaller risks a false "not
 * sent"; larger only widens the span in which an ended restart nobody saw at the press makes the
 * answer "cannot tell".
 */
export const PRESS_CLOCK_ALLOWANCE_MS = 2 * 60_000;

/**
 * The processes that may answer one restart press: its action on its own service, still running
 * or created at or after the press (`since`). Asked at the press (no `seen`), the baseline: every
 * one that could later be taken for its answer, ended ones created within the clocks' allowance
 * before it included. Asked after the send (`seen`, that baseline), `null` — cannot tell — where
 * an ended one created within the allowance before the press was not seen at it: it is this
 * press's or an earlier one; `null` too where the history read (`page`, the project's newest
 * processes as Zerops listed them) is a full page whose oldest is newer than that allowance: older
 * ones it cut off may hold one. Without a press time, running ones only, and `null` where none
 * runs: an ended one cannot be told from an earlier restart.
 */
export function restartEffects(
  processes: ReadonlyArray<ProcessValue>,
  ask: {
    readonly serviceId: string;
    readonly action: string;
    readonly since: number | undefined;
    readonly seen: ReadonlyArray<string> | undefined;
  },
  page: ReadonlyArray<ProcessValue>,
): ReadonlyArray<string> | null {
  const { since, seen } = ask;
  if (
    since !== undefined &&
    seen !== undefined &&
    page.length >= HISTORY_PAGE &&
    page.every((process) => Date.parse(process.created) >= since - PRESS_CLOCK_ALLOWANCE_MS)
  )
    return null;
  let unsure = false;
  const shown = processes
    .filter((process) => {
      if (process.actionName !== ask.action || !process.serviceStackIds.includes(ask.serviceId))
        return false;
      if (runsStill(process.status)) return true;
      if (since === undefined) return false;
      const created = Date.parse(process.created);
      if (created < since - PRESS_CLOCK_ALLOWANCE_MS) return false;
      if (created >= since || seen === undefined) return true;
      if (!seen.includes(process.id)) unsure = true;
      return false;
    })
    .map((process) => process.id);
  if (unsure || (since === undefined && shown.length === 0)) return null;
  return shown;
}

export type RestartProcess = NonNullable<ZeropsProcessOutcome["process"]> &
  Pick<Partial<ActivityProcess>, "error">;
export interface RestartReading {
  readonly sourceProcessId: string;
  readonly process: RestartProcess;
  readonly phase: "running" | "done" | "failed" | "uncertain";
  readonly requestId?: string;
  readonly progress?: OperationProgress;
  readonly failure: {
    readonly cardCause: string;
    readonly recoveryCause: string;
    readonly details?: string;
  };
  readonly retry?: {
    readonly label: string;
    readonly action:
      | { readonly kind: "submit" }
      | { readonly kind: "retry"; readonly requestId: string }
      | null;
  };
}
export interface RestartEvidence {
  readonly processes: Readonly<Record<string, RestartProcess>>;
  readonly running: ReadonlyArray<string>;
  /** Every recorded destination keeps its source, including superseded retry handles. */
  readonly sourceByProcess: Readonly<Record<string, string>>;
  readonly attempts: Readonly<
    Record<
      string,
      {
        readonly requestId: string;
        readonly processId?: string;
        readonly progress: OperationProgress;
      }
    >
  >;
}
export const NO_RESTARTS: RestartEvidence = {
  processes: {},
  running: [],
  sourceByProcess: {},
  attempts: {},
};

/** Terminal tool evidence remains useful when owner history is absent; stale RUNNING never ticks. */
export function readRestart(evidence: RestartEvidence, source: RestartProcess): RestartReading {
  const sourceProcessId = evidence.sourceByProcess[source.id] ?? source.id;
  const attempt = evidence.attempts[sourceProcessId];
  const observed = evidence.processes[attempt?.processId ?? sourceProcessId];
  const terminal = (process: RestartProcess) =>
    ["FAILED", "FINISHED", "CANCELED"].includes(process.status);
  const progress = attempt?.progress;
  let process =
    observed === undefined
      ? attempt?.processId === undefined
        ? source
        : {
            id: attempt.processId,
            actionName: "unknown",
            status:
              progress?.stage === "done"
                ? progress.outcome === "succeeded"
                  ? "FINISHED"
                  : "FAILED"
                : "UNKNOWN",
          }
      : attempt === undefined && terminal(source) && !terminal(observed)
        ? source
        : observed;
  if (progress?.stage === "done")
    process = {
      ...process,
      status:
        progress.outcome === "succeeded"
          ? "FINISHED"
          : progress.outcome === "cancelled"
            ? "CANCELED"
            : "FAILED",
    };
  const phase =
    progress?.stage === "done"
      ? progress.outcome === "succeeded"
        ? "done"
        : "failed"
      : progress?.stage === "unresolved"
        ? "uncertain"
        : attempt !== undefined && (attempt.processId === undefined || observed === undefined)
          ? progress?.stage === "refused" || progress?.stage === "unsent"
            ? "failed"
            : "uncertain"
          : process.status === "FAILED" || process.status === "CANCELED"
            ? "failed"
            : process.status === "FINISHED"
              ? "done"
              : evidence.running.includes(process.id)
                ? "running"
                : "uncertain";
  return {
    sourceProcessId,
    process,
    phase,
    failure: failureWords(process, progress),
    ...(phase === "done" || phase === "running" ? {} : { retry: retryFor(phase, attempt) }),
    ...(attempt === undefined ? {} : { requestId: attempt.requestId, progress: attempt.progress }),
  };
}

/** Safe next intent, including same-request resend. An unresolved receipt authorizes no write. */
function retryFor(
  phase: RestartReading["phase"],
  attempt: RestartEvidence["attempts"][string] | undefined,
): NonNullable<RestartReading["retry"]> {
  if (attempt === undefined)
    return phase === "failed"
      ? { label: "Try again", action: { kind: "submit" } }
      : { label: "Restart unconfirmed", action: null };
  const { progress, requestId } = attempt;
  switch (progress.stage) {
    case "refused":
      return { label: "Try again", action: { kind: "submit" } };
    case "done":
      return progress.outcome === "succeeded"
        ? { label: "Restarted", action: null }
        : { label: "Try again", action: { kind: "submit" } };
    case "unsent":
      return { label: "Try again", action: { kind: "retry", requestId } };
    case "uncertain":
      return {
        label: "Check restart",
        action: progress.next === "asking-owner" ? null : { kind: "retry", requestId },
      };
    case "unresolved":
      return { label: "Restart unconfirmed", action: null };
    case "accepted":
    case "reflected":
      return { label: "Restart requested", action: null };
    default:
      return { label: "Asking Zerops…", action: null };
  }
}

function failureWords(
  process: RestartProcess,
  progress: OperationProgress | undefined,
): RestartReading["failure"] {
  const reason =
    process.failReason ??
    process.error?.message ??
    (progress?.stage === "done" && progress.outcome !== "succeeded" ? progress.reason : undefined);
  const verb =
    process.actionName === "stack.restart"
      ? " while restarting"
      : process.actionName === "stack.start"
        ? " while starting"
        : " while preparing the container";
  const startup = reason !== undefined && /init command failed|CommandExec/iu.test(reason);
  const disk =
    reason !== undefined && /ENOSPC|EDQUOT|no space left|disk quota exceeded/iu.test(reason);
  return {
    cardCause: startup
      ? "its startup command failed"
      : disk
        ? "its disk is full"
        : "platform error",
    recoveryCause: startup
      ? "Its startup command failed."
      : disk
        ? "Its disk is full. Free space before saving or running more work."
        : reason !== undefined && /(?:\b5\d{2}\b|internal server error)/iu.test(reason)
          ? `Zerops returned an error${verb}.`
          : process.status === "CANCELED"
            ? "Zerops canceled the process."
            : "Open the process in Zerops to see what happened.",
    ...(reason === undefined ? {} : { details: reason }),
  };
}

/** Display clock formats elapsed duration only; all verdicts come from the reading. */
export function restartReadout(reading: RestartReading, name: string, now: number) {
  const { process, phase, progress } = reading;
  if (phase === "uncertain") {
    const accepted =
      progress?.stage === "accepted" ||
      progress?.stage === "reflected" ||
      (progress?.stage === "unresolved" && progress.operationId !== null);
    const text =
      reading.requestId === undefined
        ? `Zerops last reported ${name} restarting. Its outcome is unconfirmed.`
        : accepted
          ? "Zerops accepted the restart. Its outcome is unconfirmed."
          : "Zerops hasn't confirmed the restart request.";
    return {
      status: "Restart unconfirmed",
      text: `${text}${progress?.stage === "unresolved" && progress.nextAction !== undefined ? ` ${progress.nextAction}` : ""}`,
      duration: undefined,
      cardText: undefined,
    };
  }
  if (
    (progress?.stage === "refused" || progress?.stage === "unsent") &&
    progress.reason !== undefined
  )
    return {
      status: progress.stage === "unsent" ? "Restart not sent" : "Restart refused",
      text: progress.reason,
      duration: undefined,
      cardText: undefined,
    };
  const duration = formatDuration(
    (process.finished === undefined ? now : Date.parse(process.finished)) -
      Date.parse(process.started ?? process.created ?? ""),
  );
  const elapsed = duration?.replaceAll("m", " min").replaceAll("s", " sec").replaceAll("h", " hr");
  const text =
    phase === "failed"
      ? `Zerops couldn't restart ${name}${elapsed === undefined || process.finished === undefined ? "" : ` after ${elapsed}`} — ${reading.failure.cardCause}.`
      : phase === "done"
        ? `${name} restarted.`
        : `${name} is restarting${elapsed === undefined ? "" : ` — ${elapsed} elapsed`}.`;
  return {
    text,
    // The headless card keeps request explanations in its parent line, as before.
    cardText: progress?.stage === "refused" || progress?.stage === "unsent" ? undefined : text,
    status: phase === "failed" ? "Failed" : phase === "done" ? "Restarted" : "Restarting",
    duration,
  };
}

export interface RestartRecovery {
  readonly state: "running" | "failed";
  readonly verb: "start" | "restart" | null;
  readonly cause: string;
  readonly details?: string;
  readonly actions: ReadonlyArray<ReachabilityAction>;
}

/** Service standing gates old failures; live restart membership alone proves active recovery. */
export function readRestartRecovery(
  evidence: RestartEvidence,
  process: RestartProcess | undefined,
  status: string | undefined,
): RestartRecovery | undefined {
  const reading = process === undefined ? undefined : readRestart(evidence, process);
  const actionName =
    reading?.process.actionName === "unknown" ? process?.actionName : reading?.process.actionName;
  const verb =
    actionName === "stack.restart" ? "restart" : actionName === "stack.start" ? "start" : null;
  if (verb !== null && reading?.phase === "running")
    return { state: "running", verb, cause: "", actions: [] };
  if (!status?.endsWith("FAILED")) return undefined;
  const failed = reading?.phase === "failed";
  return {
    state: "failed",
    verb: failed ? verb : null,
    cause: failed
      ? reading.failure.recoveryCause
      : "Open the process in Zerops to see what happened.",
    ...(failed && reading.failure.details !== undefined
      ? { details: reading.failure.details }
      : {}),
    actions:
      verb === null ||
      reading === undefined ||
      reading.phase === "done" ||
      reading.retry?.action?.kind === "submit"
        ? ["restart", "open-in-zerops"]
        : ["open-in-zerops"],
  };
}

/** A recovery press follows its receipt even when no process or originating view exists. */
export interface RecoveryOutcome {
  readonly text: string;
  readonly details?: string;
  readonly terminal: boolean;
  readonly succeeded: boolean;
  readonly busy: boolean;
  readonly retry: NonNullable<RestartReading["retry"]>;
}

export function readRecoveryOutcome(
  requestId: string,
  action: "start" | "restart" | "redeploy",
  progress: OperationProgress,
  evidence?: string,
): RecoveryOutcome {
  const retry = retryFor("uncertain", { requestId, progress });
  const terminal =
    progress.stage === "done" || progress.stage === "refused" || progress.stage === "unsent";
  const succeeded = progress.stage === "done" && progress.outcome === "succeeded";
  const label = action === "start" ? "Start" : action === "redeploy" ? "Redeploy" : "Restart";
  let text: string;
  let details: string | undefined;
  switch (progress.stage) {
    case "refused":
      text = `${label} refused.`;
      details = progress.reason;
      break;
    case "unsent":
      text = `${label} was not sent.`;
      details = progress.reason;
      break;
    case "uncertain":
      text = `${label} unconfirmed. Zerops may have accepted the request.`;
      break;
    case "unresolved":
      text = `${label} outcome is unconfirmed.`;
      details = [progress.reason, progress.nextAction, `Next: ${progress.nextActor}.`]
        .filter(Boolean)
        .join(" ");
      break;
    case "done":
      text = succeeded
        ? `${label} completed.`
        : progress.outcome === "cancelled"
          ? `${label} was cancelled.`
          : `${label} failed.`;
      details = progress.reason ?? evidence;
      break;
    case "accepted":
    case "reflected":
      text = `Zerops accepted the ${action}. Its outcome is not confirmed yet.`;
      break;
    default:
      text = `Asking Zerops to ${action}…`;
  }
  return {
    text,
    ...(details === undefined ? {} : { details }),
    terminal,
    succeeded,
    busy:
      progress.stage === "unknown" ||
      progress.stage === "submitting" ||
      (progress.stage === "uncertain" && progress.next === "asking-owner"),
    retry: {
      ...retry,
      label:
        action !== "restart"
          ? retry.label.replace(/restart/gi, (word) => (word === "Restart" ? label : action))
          : retry.label,
    },
  };
}

/** A failed preparation never reached the write owner, so another press may submit. */
export function recoveryPreparationFailure(
  action: "start" | "restart" | "redeploy",
  reason: string,
): RecoveryOutcome {
  return {
    text: `Could not request the ${action}.`,
    details: reason,
    terminal: true,
    succeeded: false,
    busy: false,
    retry: { label: "Try again", action: { kind: "submit" } },
  };
}
