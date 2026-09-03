/**
 * The phrase producer — English, short, second person absent (Mate speaks
 * about the project, never to it). Used whenever the agent did not supply its
 * own `voice` line, and always for `statusWord` / `closing`, since those are
 * result-driven rather than agent-authored.
 *
 * Never render a raw enum in a label: every raw status a card shows goes
 * through `statusWord` first.
 */
import type { ZeropsOperationKind, ZeropsOperationPhase } from "./types.ts";

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
export function operationStatusWord(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  context: OperationStatusWordContext = {},
): string {
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
        return "Working";
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
    case "bootstrap":
      return "Complete";
    case "error":
      return "Failed";
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
}

/** The closing line, once `phase !== "running"` — outcome + the one thing the user needs. */
export function operationClosing(
  kind: ZeropsOperationKind,
  phase: Exclude<ZeropsOperationPhase, "running">,
  context: OperationClosingContext,
): string {
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
    case "bootstrap":
      return context.messageFirstParagraph ?? "Bootstrap complete.";
    case "error":
      return context.errorFirstLine ?? "Failed.";
  }
}
