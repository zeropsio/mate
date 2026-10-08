/** A restart's receipt and process reading, held by the account independently of its card. */
import { formatDuration } from "../../zerops/activity/pipelineReadout.ts";
import type { ActivityProcess } from "../../zerops/activity/dto.ts";
import type { ReachabilityAction } from "../../zerops/environments/index.ts";
import type { ZeropsProcessOutcome } from "../../zerops/cards/payloads.ts";
import type { Projection } from "../store.ts";
import { runningScope } from "../families/process.ts";
import { scopeFreshness } from "./freshness.ts";
import { sameValue } from "./equal.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";
import type { ProjectKey } from "./processes.ts";

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
export const NO_RESTARTS: RestartEvidence = { processes: {}, running: [], attempts: {} };

export const projectRestarts: Projection<ProjectKey, RestartEvidence> = {
  name: "projectRestarts",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  equals: sameValue,
  derive: (read, { orgId, projectId }) => {
    const processes: Record<string, RestartProcess> = {};
    for (const id of read.index("project", projectId)) {
      const fact = read.fact("process", id);
      if (fact.kind === "known") processes[id] = fact.value;
    }
    const attempts: Record<string, RestartEvidence["attempts"][string]> = {};
    // Index order is explicit submission order, never a timestamp-based verdict.
    for (const requestId of read.index("restartOperations", `${orgId}/${projectId}`)) {
      const record = read.operation(requestId);
      if (record?.intent.kind !== "mate-restart" || record.intent.sourceProcessId === undefined)
        continue;
      const processId = record.receipt?.handles[0] ?? record.handles[0];
      if (processId !== undefined) {
        const fact = read.fact("process", processId);
        if (fact.kind === "known") processes[processId] = fact.value;
      }
      attempts[record.intent.sourceProcessId] = {
        requestId,
        progress: operationProgress.derive(read, requestId),
        ...(processId === undefined ? {} : { processId }),
      };
    }
    return {
      processes,
      running: scopeFreshness(read, runningScope(orgId)).live
        ? [...read.index("running", projectId)]
        : [],
      attempts,
    };
  },
};

/** Terminal tool evidence remains useful when owner history is absent; stale RUNNING never ticks. */
export function readRestart(evidence: RestartEvidence, source: RestartProcess): RestartReading {
  const attempt = evidence.attempts[source.id];
  const observed = evidence.processes[attempt?.processId ?? source.id];
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
    sourceProcessId: source.id,
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
    progress?.stage === "done" && progress.outcome !== "succeeded"
      ? (progress.reason ?? process.failReason ?? process.error?.message)
      : (process.failReason ?? process.error?.message);
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
      status: "Restart refused",
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
  const sourceId =
    process === undefined
      ? undefined
      : Object.keys(evidence.attempts).find(
          (id) => evidence.attempts[id]?.processId === process.id,
        );
  const reading =
    process === undefined
      ? undefined
      : readRestart(evidence, sourceId === undefined ? process : { ...process, id: sourceId });
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
      verb === null || reading === undefined || reading.retry?.action?.kind === "submit"
        ? ["restart", "open-in-zerops"]
        : ["open-in-zerops"],
  };
}
