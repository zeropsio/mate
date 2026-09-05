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
import type { ZeropsOperationKind, ZeropsOperationPhase } from "../model/types.ts";

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

export interface OperationStatusWordContext {
  readonly resultStatus?: string | undefined;
  readonly action?: string | undefined;
  /** `devServer` only: the decoded card's own `running` field. */
  readonly running?: boolean | undefined;
}

const PAST_PARTICIPLE: Readonly<Record<string, string>> = {
  delete: "Deleted",
  scale: "Scaled",
  manage: "Managed",
  env: "Updated",
};

/**
 * The status word for a kind × phase — the free-text word next to the status
 * dot. Never a raw platform enum.
 */
/** Kind-independent words for the outcomes no per-kind claim ever applies to. */
export function settledPhaseWord(
  phase: Extract<ZeropsOperationPhase, "declined" | "stopped" | "interrupted" | "reset">,
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
  }
}

export function operationStatusWord(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  context: OperationStatusWordContext = {},
): string {
  if (phase === "declined" || phase === "stopped" || phase === "interrupted" || phase === "reset") {
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
      case "scale":
      case "manage":
      case "env":
      case "devServer":
        return "Working";
      case "browser":
        return "Checking";
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

/** "1 thing" vs "2 things" — the small plural forms these closings need. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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

export interface BrowserCondensedLineInput {
  readonly url: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly media?: "dark" | "light";
  readonly stepCount: number;
  readonly consoleErrorCount: number;
  readonly pageErrorCount: number;
  readonly failedRequestCount: number;
}

/** The viewport segment — `<w>×<h>[, dark]`, `dark` alone with no known viewport, or absent entirely. */
function browserViewportSegment(input: BrowserCondensedLineInput): string | undefined {
  if (input.viewport !== undefined) {
    const dimensions = `${input.viewport.width}×${input.viewport.height}`;
    return input.media === "dark" ? `${dimensions}, dark` : dimensions;
  }
  return input.media === "dark" ? "dark" : undefined;
}

/**
 * The card's condensed line, under the viewport —
 * `opened <url> · <viewport w×h>[, dark] · <n> steps · <errors> errors, <failed requests> failed requests`.
 * `errors` folds `consoleErrorCount` and `pageErrorCount` into one figure —
 * `browserClosing`'s Details-disclosure text keeps them apart, this line
 * does not have the room.
 */
export function browserCondensedLine(input: BrowserCondensedLineInput): string {
  const segments = [
    `opened ${input.url}`,
    browserViewportSegment(input),
    plural(input.stepCount, "step"),
    `${plural(input.consoleErrorCount + input.pageErrorCount, "error")}, ${plural(input.failedRequestCount, "failed request")}`,
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
