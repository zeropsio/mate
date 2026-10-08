import type { RestartReading, RestartProcess } from "../../../data/projections/restart.ts";
/**
 * Small helpers every per-kind builder shares: reading a call's decoded card,
 * the step/status-word/voice plumbing, and `phaseFor` — the ONE mapping from
 * a call's status to an operation's phase (declined/stopped are their own
 * outcome, never folded into "done" — the bug §2.6 fixes).
 */
import type { DeployBuildRead } from "../../activity/deployBuild.ts";
import { deployFailureWords, readFailureClassification } from "../../operations/failureWords.ts";
import {
  readRecord,
  readString,
  readZeropsCardSource,
  type ZeropsCardSource,
} from "../../cards/decode.ts";
import { decodeZeropsCard, type ZeropsCardPayload } from "../../cards/payloads.ts";
import {
  neutralStatusWord,
  operationStatusWord,
  operationVoice,
  statusWord,
  type OperationStatusWordContext,
} from "../../operations/phrases.ts";
import type {
  ZeropsBrowserRead,
  ZeropsBrowserViewport,
  ZeropsCall,
  ZeropsOperationBrowserSummary,
  ZeropsOperationExplanation,
  ZeropsOperationKind,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationPullRequest,
  ZeropsOperationStep,
  ZeropsOperationStepState,
  ZeropsOperation,
  ZeropsOperationVersion,
  ZeropsEnvChange,
  ZeropsReadResult,
} from "../types.ts";

/** What a builder reads besides its call: the thread's project, and the builds deploys named. */
export interface OperationBuildContext {
  /** The thread's Zerops project, from the known lifecycle envelope; undefined while none is known. */
  readonly projectId: string | undefined;
  /** Where the build a deploy result named by its appVersion stands on the platform. */
  readonly builds: (appVersionId: string) => DeployBuildRead;
  readonly restarts?: (process: RestartProcess) => RestartReading;
}

/**
 * What a per-kind builder returns: everything about a `ZeropsOperation` that
 * depends on the tool's own shape. `operations.ts` fills in the rest (key,
 * kind, phase, anchor, callIds) — the same fields for every kind.
 */
export interface BuiltCardFields {
  readonly subject: string;
  readonly kicker: string;
  readonly voice: string;
  readonly voiceSource: "agent" | "mate";
  readonly statusWord: string;
  readonly closing?: string;
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
  readonly links: ReadonlyArray<ZeropsOperationLink>;
  readonly target?: { readonly hostname: string };
  readonly batch?: true;
  /** `deploy` only: delivered by a push to a git remote. */
  readonly strategy?: "git-push";
  /** `deploy` with the git-push strategy only: the pull request the branch lands through. */
  readonly pullRequest?: ZeropsOperationPullRequest;
  readonly resultStatus?: string;
  readonly hasResult: boolean;
  readonly version?: ZeropsOperationVersion;
  readonly processIds?: ReadonlyArray<string>;
  readonly restartProcess?: NonNullable<ZeropsOperation["restartProcess"]>;
  readonly restartReading?: RestartReading;
  readonly appVersionIds?: ReadonlyArray<string>;
  readonly explanation?: ZeropsOperationExplanation;
  /** `browser` only: the last call's screenshot, as a data URI ready for an `<img src>`. */
  readonly screenshot?: { readonly src: string; readonly width?: number; readonly height?: number };
  /** `browser` only. */
  readonly browserSummary?: ZeropsOperationBrowserSummary;
  /** `browser` only: what the check read of the page, when it took no picture. */
  readonly browserRead?: ZeropsBrowserRead;
  /** `browser` only. */
  readonly viewport?: ZeropsBrowserViewport;
  /** `browser` only: the device the agent emulated (`set device <name>`), as agent-browser names it. */
  readonly deviceName?: string;
  /** `logs` · `events` · `process` · `discover` only. */
  readonly readResult?: ZeropsReadResult;
  /** `env` only. */
  readonly envChange?: ZeropsEnvChange;
  /**
   * Overrides `phaseFor(call.status)`, where the call's own status is not what
   * happened: `deploy`'s BUILD_TRIGGERED reads as the build it named stands
   * (uncertain where that cannot be read), and a `verify` whose checks failed
   * is failed however cleanly the tool returned.
   */
  readonly phaseOverride?: ZeropsOperationPhase;
}

/**
 * The one line a person should read. A zcli SSH-deploy error is a multi-line
 * CLI log transcript whose own first line is a generic "X failed:" header —
 * the actionable reason is the first `level=error msg="…"` line (zcli's own
 * log format), so that one wins when present; otherwise the literal first
 * line, which is already the whole story for every other zcp error shape.
 */
export function firstLine(text: string): string {
  const cliErrorLine = text.match(/level=error msg="([^"]*)"/);
  const message = cliErrorLine?.[1];
  if (message !== undefined) {
    return message.replace(/^[✗✓➤]\s*(ERR|DONE|INFO)\s*/, "").trim();
  }
  return (text.split("\n")[0] ?? text).trim();
}

export function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? text).trim();
}

/** The host portion of a URL, without a scheme parser — R1 keeps this platform-free. */
export function urlHost(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? url;
}

export function stepState(rawStatus: string): ZeropsOperationStepState {
  switch (statusWord(rawStatus)) {
    case "Done":
    case "Skipped":
      return "done";
    case "Running":
      return "running";
    case "Failed":
      return "failed";
    case "Waiting":
      return "queued";
    default:
      return "queued";
  }
}

/** A step no result has reported on reads as the call's own phase. */
export const UNREPORTED_STEP_STATUS: Readonly<Record<ZeropsOperationPhase, string>> = {
  running: "in_progress",
  done: "FINISHED",
  failed: "FAILED",
  uncertain: "pending",
  declined: "pending",
  stopped: "pending",
  interrupted: "pending",
  reset: "pending",
};

export function buildStep(
  id: string,
  label: string,
  rawStatus: string,
  note?: string,
): ZeropsOperationStep {
  return {
    id,
    label,
    state: stepState(rawStatus),
    stateLabel: statusWord(rawStatus),
    ...(note !== undefined && note.length > 0 ? { note } : {}),
  };
}

/** Every call read in this module goes through here — the one wire reader. */
function cardSourceForCall(call: ZeropsCall): ZeropsCardSource | undefined {
  return readZeropsCardSource(
    {
      toolName: call.toolName,
      ...(call.resultText !== undefined ? { resultText: call.resultText } : {}),
      ...(call.truncated ? { truncated: true } : {}),
    },
    { failed: call.status === "failed" },
  );
}

export interface DecodedEntry {
  readonly document?: Record<string, unknown> | undefined;
  readonly card?: ZeropsCardPayload | undefined;
}

/** A call decoded exactly once, at fold time — every later read reuses this. */
export function decodeCall(call: ZeropsCall): DecodedEntry {
  const source = cardSourceForCall(call);
  return { document: source?.document, card: decodeZeropsCard(source) };
}

export interface ErrorInfo {
  readonly message: string;
}

export function errorInfoFor(call: ZeropsCall, decoded: DecodedEntry): ErrorInfo | undefined {
  if (call.status !== "failed") {
    return undefined;
  }
  if (decoded.card?.kind === "error") {
    return { message: decoded.card.message };
  }
  const rawMessage = readString(decoded.document?.error) ?? call.resultText;
  return { message: rawMessage ?? "Failed." };
}

export function readInputString(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return readString(input?.[key]);
}

export function pickFirst(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((v) => v !== undefined);
}

export const KIND_LABEL: Readonly<
  Record<Exclude<ZeropsOperationKind, "bootstrap" | "error">, string>
> = {
  deploy: "Deploy",
  import: "Import",
  mount: "Mount",
  verify: "Verify",
  subdomain: "Subdomain",
  delete: "Delete",
  scale: "Scale",
  manage: "Manage",
  env: "Env",
  devServer: "Dev server",
  browser: "Browser",
  logs: "Logs",
  events: "Events",
  process: "Process",
  discover: "Discover",
  standup: "Stand-up",
};

/** The ONE call-status → operation-phase mapping (§2.3, declined/stopped are not "done"). */
export function phaseFor(status: ZeropsCall["status"]): ZeropsOperationPhase {
  switch (status) {
    case "inProgress":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "declined":
      return "declined";
    case "stopped":
      return "stopped";
    case "interrupted":
      return "interrupted";
  }
}

/**
 * The status word: the kind's own verb/claim when a card decoded, OR when no
 * result has landed at all yet — a running verb ("Deploying", "Checking",
 * "In progress", …) describes what is happening, not a claim the result
 * made, so a pending call keeps it. The neutral word (`neutralStatusWord`)
 * applies only once a result has landed and still did not decode.
 */
export function gatedStatusWord(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  hasCard: boolean,
  hasResult: boolean,
  context?: OperationStatusWordContext,
): string {
  return hasCard || !hasResult
    ? operationStatusWord(kind, phase, context)
    : neutralStatusWord(phase);
}

export function mateVoiceFor(
  kind: ZeropsOperationKind,
  subject: string,
): { voice: string; voiceSource: "agent" | "mate" } {
  return { voice: operationVoice(kind, subject), voiceSource: "mate" };
}

/** How many of a failure's log lines a card carries — the end of the log, where the failure is. */
export const EXPLANATION_LOG_TAIL_LINES = 12;

/** `{ explanation }` when there is a reason to give, else `{}` — spread directly into the built fields. */
export function explanationField(
  reason: string | undefined,
  log: ReadonlyArray<string> | undefined = undefined,
): { explanation: ZeropsOperationExplanation } | Record<string, never> {
  if (reason === undefined) {
    return {};
  }
  const logTail = log?.slice(-EXPLANATION_LOG_TAIL_LINES) ?? [];
  return { explanation: { reason, ...(logTail.length > 0 ? { logTail } : {}) } };
}

/** A failed call's reason: what zcp classified it as, in the person's words, else the error's own line. */
export function failedCallReason(decoded: DecodedEntry, errorInfo: ErrorInfo): string {
  return (
    deployFailureWords(readFailureClassification(decoded.document?.failureClassification)) ??
    firstLine(errorInfo.message)
  );
}

export { readRecord };
