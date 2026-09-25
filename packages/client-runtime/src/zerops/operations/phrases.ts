/**
 * The phrase producer — English, short, second person absent (Mate speaks
 * about the project, never to it). Used for every operation kind's `voice`
 * except `bootstrap`, where the session's own `intent` wins when present —
 * zcp ships no per-call `intent` on any other tool. Always used for
 * `statusWord` / `closing`, since those are result-driven rather than
 * agent-authored.
 *
 * Never render a raw enum in a label: every raw status a card shows goes
 * through `statusWord` first.
 */
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type {
  ZeropsOperationKind,
  ZeropsOperationPhase,
  ZeropsOperationStepState,
} from "../model/types.ts";

export function sentenceCase(raw: string): string {
  const words = raw.trim().toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return raw;
  }
  return [words[0]![0]!.toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(" ");
}

const DONE_RAWS: ReadonlySet<string> = new Set([
  "ACTIVE",
  "DEPLOYED",
  "FINISHED",
  "complete",
  "pass",
  "healthy",
  "mounted",
]);
const RUNNING_RAWS: ReadonlySet<string> = new Set([
  "BUILDING",
  "DEPLOYING",
  "RUNNING",
  "in_progress",
  "running",
]);
const FAILED_RAWS: ReadonlySet<string> = new Set(["FAILED", "BUILD_FAILED", "fail", "error"]);

/** A word for people, for a raw platform/tool status. Never render `raw` verbatim. */
export function statusWord(raw: string): string {
  if (DONE_RAWS.has(raw)) {
    return "Done";
  }
  if (RUNNING_RAWS.has(raw)) {
    return "Running";
  }
  if (FAILED_RAWS.has(raw)) {
    return "Failed";
  }
  if (raw === "pending" || raw.startsWith("WAITING_")) {
    return "Waiting";
  }
  if (raw === "skipped") {
    return "Skipped";
  }
  return sentenceCase(raw);
}

const UPPERCASE_TOKENS: ReadonlySet<string> = new Set(["http", "https", "url", "ssh", "db"]);

/** `service_running` → `"Service running"`, `http_root` → `"HTTP root"`. */
export function humanizeCheckName(name: string): string {
  return sentenceCase(name)
    .split(" ")
    .map((word) => (UPPERCASE_TOKENS.has(word.toLowerCase()) ? word.toUpperCase() : word))
    .join(" ");
}

/** `zerops_discover` → `"Discover"`. */
export function humanizeToolName(toolName: string): string {
  return sentenceCase(toolName.replace(/^zerops_/, ""));
}

/** "1 error", "3 warnings" — a count with its noun. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `stack.enableSubdomainAccess` → `"Enable subdomain access"` — a platform process's action, never its raw name. */
export function processActionWord(actionName: string): string {
  const action = actionName.slice(actionName.lastIndexOf(".") + 1);
  return sentenceCase(action.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

/**
 * A platform process (`ProcessStatusEnum`) or app-version status as every
 * card shows it — a deploy's secondary row, a process card's step, an events
 * row: the row's state, its dot's tone (the state's own, as `ProcessSteps`
 * draws it) and its word.
 */
export interface PlatformStatus {
  readonly state: ZeropsOperationStepState;
  readonly tone: ServiceStatusToneId;
  readonly word: string;
}

const STATE_TONE: Readonly<Record<ZeropsOperationStepState, ServiceStatusToneId>> = {
  queued: "off",
  running: "busy",
  done: "ok",
  failed: "failed",
};

/** `ProcessStatusEnum` in words; a cancelled process was stopped, not failed. */
const PROCESS_STATUS: Readonly<
  Record<string, { readonly state: ZeropsOperationStepState; readonly word: string }>
> = {
  PENDING: { state: "queued", word: "Queued" },
  RUNNING: { state: "running", word: "Running" },
  ROLLBACKING: { state: "running", word: "Rolling back" },
  CANCELING: { state: "running", word: "Cancelling" },
  FINISHED: { state: "done", word: "Done" },
  FAILED: { state: "failed", word: "Failed" },
  CANCELED: { state: "queued", word: "Cancelled" },
};

/** App-version states still in flight whose `statusWord` is not already "Running". */
const IN_FLIGHT_APP_VERSION_STATUSES: ReadonlySet<string> = new Set([
  "UPLOADING",
  "PREPARING_RUNTIME",
]);

export function platformStatus(raw: string): PlatformStatus {
  const known = PROCESS_STATUS[raw];
  const word = known?.word ?? statusWord(raw);
  const state: ZeropsOperationStepState =
    known?.state ??
    (word === "Failed" || /FAIL/u.test(raw)
      ? "failed"
      : word === "Done"
        ? "done"
        : word === "Running" || IN_FLIGHT_APP_VERSION_STATUSES.has(raw)
          ? "running"
          : "queued");
  return { state, tone: STATE_TONE[state], word };
}

/**
 * An operation's tone — its card's dot and edge, and every summary of it
 * (the turn tally): running → busy, failed → failed; uncertain, or a
 * settled operation with a failed step → attention; else ok.
 */
export function operationTone(operation: {
  readonly phase: ZeropsOperationPhase;
  readonly steps: ReadonlyArray<{ readonly state: ZeropsOperationStepState }>;
}): ServiceStatusToneId {
  if (operation.phase === "running") {
    return "busy";
  }
  if (operation.phase === "failed") {
    return "failed";
  }
  if (operation.phase === "uncertain") {
    return "attention";
  }
  return operation.steps.some((step) => step.state === "failed") ? "attention" : "ok";
}

export interface OperationStatusWordContext {
  readonly resultStatus?: string | undefined;
  readonly action?: string | undefined;
  /** `devServer` only: the decoded card's own `running` field. */
  readonly running?: boolean | undefined;
  /** `process` only: what the processes it read came to, when not simply done. */
  readonly processOutcome?: "failed" | "timedOut" | "canceled" | undefined;
}

const PROCESS_OUTCOME_WORD: Readonly<Record<"failed" | "timedOut" | "canceled", string>> = {
  failed: "Process failed",
  timedOut: "Still running",
  canceled: "Cancelled",
};

const PAST_PARTICIPLE: Readonly<Record<string, string>> = {
  delete: "Deleted",
  scale: "Scaled",
  manage: "Managed",
  env: "Updated",
};

/** A dev server call in flight, by its action — an unknown or unnamed one is only "Working". */
const DEV_SERVER_RUNNING_WORD: Readonly<Record<string, string>> = {
  start: "Starting",
  restart: "Restarting",
  stop: "Stopping",
  status: "Checking",
  logs: "Reading",
};

/** The label of a link to the project on the Zerops dashboard. */
export const OPEN_IN_ZEROPS = "Open in Zerops";

/**
 * The status word for a kind × phase — the free-text word next to the status
 * dot. Never a raw platform enum.
 */
/** Kind-independent words for the outcomes no per-kind claim ever applies to. */
export function settledPhaseWord(
  phase: Extract<
    ZeropsOperationPhase,
    "declined" | "stopped" | "interrupted" | "reset" | "uncertain"
  >,
): string {
  switch (phase) {
    case "declined":
      return "Declined";
    case "stopped":
      return "Stopped";
    case "interrupted":
      return "Interrupted";
    case "reset":
      return "Reset";
    case "uncertain":
      return "Unconfirmed";
  }
}

export function operationStatusWord(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  context: OperationStatusWordContext = {},
): string {
  if (
    phase === "declined" ||
    phase === "stopped" ||
    phase === "interrupted" ||
    phase === "reset" ||
    phase === "uncertain"
  ) {
    return settledPhaseWord(phase);
  }
  if (phase === "running") {
    if (kind === "deploy" && context.resultStatus === "BUILD_TRIGGERED") {
      return "Build triggered";
    }
    switch (kind) {
      case "deploy":
        return "Deploying";
      case "verify":
        return "Checking";
      case "import":
        return "Importing";
      case "mount":
        return "Mounting";
      case "subdomain":
        return context.action === "disable" ? "Disabling" : "Enabling";
      case "delete":
        return "Deleting";
      case "scale":
        return "Scaling";
      case "manage":
        return "Managing";
      case "env":
        return "Updating";
      case "devServer":
        return DEV_SERVER_RUNNING_WORD[context.action ?? ""] ?? "Working";
      case "browser":
        return "Checking";
      case "logs":
      case "events":
      case "discover":
        return "Reading";
      case "process":
        return context.action === "wait"
          ? "Waiting"
          : context.action === "cancel"
            ? "Cancelling"
            : "Checking";
      case "bootstrap":
        return "In progress";
      case "error":
        return "Failed";
    }
  }
  if (phase === "failed") {
    switch (kind) {
      case "verify":
        return "Checks failed";
      case "import":
        return "Import failed";
      case "mount":
        return "Mount failed";
      default:
        return "Failed";
    }
  }
  // phase === "done"
  switch (kind) {
    case "deploy":
      return "Deployed";
    case "verify":
      return "Healthy";
    case "import":
      return "Imported";
    case "mount":
      return "Mounted";
    case "subdomain":
      return context.action === "disable" ? "Disabled" : "Enabled";
    case "delete":
    case "scale":
    case "manage":
    case "env":
      return PAST_PARTICIPLE[kind]!;
    case "devServer":
      return context.running === false ? "Not running" : "Running";
    case "browser":
      return "Checked";
    case "logs":
    case "events":
      return "Read";
    case "discover":
      return "Listed";
    case "process":
      return context.processOutcome === undefined
        ? "Done"
        : PROCESS_OUTCOME_WORD[context.processOutcome];
    case "bootstrap":
      return "Complete";
    case "error":
      return "Failed";
  }
}

/**
 * The status word for a phase when the result did not decode — a kind's own
 * word ("Healthy", "Deployed", "Complete", …) is a claim about what the
 * result said, and an undecoded result never said it. Same three words the
 * closing already falls back to in spirit ("Finished." / "Failed."), just as
 * a status-dot word.
 */
export function neutralStatusWord(phase: ZeropsOperationPhase): string {
  switch (phase) {
    case "running":
      return "Working";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "declined":
    case "stopped":
    case "interrupted":
    case "reset":
    case "uncertain":
      return settledPhaseWord(phase);
  }
}

const DELETE_SCALE_MANAGE_ENV_VOICE: Readonly<Record<string, string>> = {
  delete: "Deleting",
  scale: "Scaling",
  manage: "Managing",
};

/**
 * The opening line, in Mate's voice, when the agent did not supply its own
 * `intent`. Computed once at operation creation and never recomputed as the
 * operation settles.
 */
export function operationVoice(kind: ZeropsOperationKind, subject: string): string {
  switch (kind) {
    case "deploy":
      return `Deploying ${subject}.`;
    case "verify":
      return `Checking ${subject}.`;
    case "import":
      return `Creating ${subject}.`;
    case "mount":
      return `Mounting ${subject}.`;
    case "subdomain":
      return `Updating the subdomain of ${subject}.`;
    case "delete":
    case "scale":
    case "manage":
      return `${DELETE_SCALE_MANAGE_ENV_VOICE[kind]} ${subject}.`;
    case "env":
      return `Updating environment of ${subject}.`;
    case "devServer":
      return `Managing the dev server on ${subject}.`;
    case "browser":
      return `Checking ${subject}.`;
    case "logs":
      return `Reading the ${subject} log.`;
    case "events":
      return `Reading recent events of ${subject}.`;
    case "process":
      return `Following ${subject}.`;
    case "discover":
      return `Looking at ${subject}.`;
    case "bootstrap":
      return `Setting up ${subject}.`;
    case "error":
      return `${subject} failed.`;
  }
}

export interface OperationClosingContext {
  readonly host?: string | undefined;
  readonly failureCause?: string | undefined;
  readonly errorFirstLine?: string | undefined;
  readonly checksPassed?: number | undefined;
  readonly checksTotal?: number | undefined;
  readonly checksFailed?: number | undefined;
  readonly summary?: string | undefined;
  readonly createdCount?: number | undefined;
  readonly mountedCount?: number | undefined;
  readonly mountsTotal?: number | undefined;
  readonly action?: string | undefined;
  readonly message?: string | undefined;
  readonly messageFirstParagraph?: string | undefined;
  /** `devServer` only. */
  readonly hostname?: string | undefined;
  readonly port?: number | undefined;
  readonly running?: boolean | undefined;
  /** `browser` only. */
  readonly url?: string | undefined;
  readonly consoleErrorCount?: number | undefined;
  readonly pageErrorCount?: number | undefined;
  readonly failedRequestCount?: number | undefined;
}

function devServerClosing(context: OperationClosingContext): string {
  const host = context.hostname ?? "the dev server";
  if (context.action === "stop") {
    return `${host} stopped.`;
  }
  if (context.action === "logs") {
    return `Read the ${host} log.`;
  }
  if (context.running === false) {
    return `${host} did not come up.`;
  }
  return context.port !== undefined
    ? `dev server running on ${host}:${context.port}.`
    : `dev server running on ${host}.`;
}

function browserClosing(context: OperationClosingContext): string {
  const target = context.url ?? "the page";
  const counts = [
    plural(context.consoleErrorCount ?? 0, "console error"),
    plural(context.pageErrorCount ?? 0, "page error"),
    plural(context.failedRequestCount ?? 0, "failed request"),
  ].join(", ");
  return `checked ${target}. ${counts}.`;
}

export interface BrowserFiguresInput {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly media?: "dark" | "light";
  readonly stepCount: number;
  readonly consoleErrorCount: number;
  readonly pageErrorCount: number;
  readonly failedRequestCount: number;
}

/** The viewport segment — `<w>×<h>[, dark]`, `dark` alone with no known viewport, or absent entirely. */
function browserViewportSegment(input: BrowserFiguresInput): string | undefined {
  if (input.viewport !== undefined) {
    const dimensions = `${input.viewport.width}×${input.viewport.height}`;
    return input.media === "dark" ? `${dimensions}, dark` : dimensions;
  }
  return input.media === "dark" ? "dark" : undefined;
}

/**
 * A browser check's figures, beside its thumbnail —
 * `<viewport w×h>[, dark] · <n> steps · <errors> errors[ · <n> failed requests]`.
 * The page is the card's subject, so the line never repeats it. `errors`
 * folds `consoleErrorCount` and `pageErrorCount` into one figure and is
 * always said, zero included; failed requests are named only when there are
 * some. `browserClosing`'s text keeps all three apart.
 */
export function browserFiguresLine(input: BrowserFiguresInput): string {
  const segments = [
    browserViewportSegment(input),
    plural(input.stepCount, "step"),
    plural(input.consoleErrorCount + input.pageErrorCount, "error"),
    input.failedRequestCount > 0 ? plural(input.failedRequestCount, "failed request") : undefined,
  ].filter((segment): segment is string => segment !== undefined);
  return segments.join(" · ");
}

/** The caption over the live viewport while the call is in progress. */
export function browserLiveCaption(subject: string): string {
  return `Agent is verifying ${subject}.`;
}

/** The closing line, once `phase !== "running"` — outcome + the one thing the user needs. */
export function operationClosing(
  kind: ZeropsOperationKind,
  phase: Exclude<ZeropsOperationPhase, "running">,
  context: OperationClosingContext,
): string {
  if (phase === "declined") {
    return "Declined.";
  }
  if (phase === "stopped") {
    return "Stopped.";
  }
  if (phase === "interrupted") {
    return "The agent did not report a result.";
  }
  if (phase === "reset") {
    return "Reset.";
  }
  if (phase === "uncertain") {
    // Only a deploy's triggered build reaches it (`builders/deploy.ts`).
    return "No result from the build. Check it in Zerops.";
  }
  if (phase === "failed") {
    switch (kind) {
      case "deploy":
        return context.failureCause ?? context.errorFirstLine ?? "Failed.";
      case "verify":
        return `${context.checksFailed ?? 0} of ${context.checksTotal ?? 0} checks failed.`;
      default:
        return context.errorFirstLine ?? "Failed.";
    }
  }
  // phase === "done"
  switch (kind) {
    case "deploy":
      return `${context.host ?? "The service"} is live.`;
    case "verify": {
      const n = context.checksPassed ?? context.checksTotal ?? 0;
      return n === 1 ? "Check passed." : `All ${n} checks passed.`;
    }
    case "import":
      return context.summary ?? `${context.createdCount ?? 0} services created.`;
    case "mount":
      return `${context.mountedCount ?? 0} of ${context.mountsTotal ?? 0} services mounted.`;
    case "subdomain":
      return context.action === "disable" ? "Disabled." : "Enabled.";
    case "delete":
    case "scale":
    case "manage":
    case "env":
    case "logs":
    case "events":
    case "process":
    case "discover":
      return context.message ?? context.summary ?? "Finished.";
    case "devServer":
      return devServerClosing(context);
    case "browser":
      return browserClosing(context);
    case "bootstrap":
      return context.messageFirstParagraph ?? "Bootstrap complete.";
    case "error":
      return context.errorFirstLine ?? "Failed.";
  }
}
