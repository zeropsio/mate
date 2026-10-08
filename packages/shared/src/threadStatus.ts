import {
  PROVIDER_DISPLAY_NAMES,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type OrchestrationThreadShell,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import type { RelayAgentAwarenessPhase } from "@t3tools/contracts/relay";
import type { MateMarkState } from "./brand.ts";
import { isLatestTurnSettled } from "./orchestrationTiming.ts";

/** A provider refusal, distinct from allowed or warning admission telemetry. */
export function usageLimitProvider(
  error: string | null | undefined,
  driver?: string | null,
): string | null {
  if (!error) return null;
  const known = Object.entries(PROVIDER_DISPLAY_NAMES).find(([key]) => key === driver)?.[1];
  const matched =
    /^(Claude(?: AI)?|Codex|Grok|OpenCode|Cursor|Antigravity|Coding agent) usage limit reached\b/i.exec(
      error.trim(),
    );
  if (matched)
    return matched[1]!.toLowerCase() === "coding agent"
      ? (known ?? "coding agent")
      : matched[1]!.replace(/ AI$/i, "");
  return /^you[’']ve hit your [\w\s-]*?limit\b/i.test(error.trim())
    ? (known ?? "coding agent")
    : null;
}

export type ThreadStatusKind =
  | "approval"
  | "input"
  | "failed"
  | "connecting"
  | "working"
  | "planReady"
  | "monitoring"
  | "done"
  | "woke"
  | "idle";

export type ThreadStatusToneId =
  | "attention"
  | "input"
  | "active"
  | "danger"
  | "plan"
  | "success"
  | "neutral";

export type ThreadStatusInput = Pick<
  OrchestrationThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
> & {
  readonly lastVisitedAt?: string | null;
  readonly wokeAt?: string | null;
};

/**
 * What the resolver reads of a thread: a shell's turn and session hold more, a Mate's overview of
 * its chat (`@t3tools/shared/mateLink`) no more than this.
 */
export type ThreadStatusFields = Omit<ThreadStatusInput, "latestTurn" | "session"> & {
  readonly latestTurn: Pick<
    OrchestrationLatestTurn,
    "turnId" | "state" | "startedAt" | "completedAt"
  > | null;
  readonly session:
    | (Pick<OrchestrationSession, "status"> &
        Partial<Pick<OrchestrationSession, "lastError" | "providerName">>)
    | null;
  readonly usagePause?: { readonly resetsAt: string } | null | undefined;
};

export interface ThreadStatus {
  readonly kind: ThreadStatusKind;
  readonly toneId: ThreadStatusToneId;
}

export function hasUnseenCompletion(thread: {
  readonly latestTurn: { readonly completedAt: string | null } | null;
  readonly lastVisitedAt?: string | null | undefined;
}): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt) || !thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  return Number.isNaN(lastVisitedAt) || completedAt > lastVisitedAt;
}

function hasUnseenWake(thread: Pick<ThreadStatusInput, "lastVisitedAt" | "wokeAt">): boolean {
  if (!thread.wokeAt) return false;
  const wokeAt = Date.parse(thread.wokeAt);
  if (Number.isNaN(wokeAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  return Number.isNaN(lastVisitedAt) || wokeAt > lastVisitedAt;
}

/** The tone a status kind is drawn in: the resolver's own, for a kind read without a thread. */
export function toneIdForKind(kind: ThreadStatusKind): ThreadStatusToneId {
  switch (kind) {
    case "approval":
    case "woke":
      return "attention";
    case "input":
      return "input";
    case "connecting":
    case "working":
    case "monitoring":
      return "active";
    case "failed":
      return "danger";
    case "planReady":
      return "plan";
    case "done":
      return "success";
    case "idle":
      return "neutral";
  }
}

function status(kind: ThreadStatusKind): ThreadStatus {
  return { kind, toneId: toneIdForKind(kind) };
}

/** Refused admission stays refused until the source clears it; a running SDK is not admission. */
export function isProviderRefused(
  thread: Pick<ThreadStatusFields, "session" | "usagePause"> | null | undefined,
): boolean {
  return (
    thread?.usagePause != null ||
    usageLimitProvider(thread?.session?.lastError, thread?.session?.providerName) !== null
  );
}

export function resolveThreadStatus(thread: ThreadStatusFields): ThreadStatus {
  if (thread.hasPendingApprovals) return status("approval");
  if (thread.hasPendingUserInput) return status("input");
  if (isProviderRefused(thread)) return status("failed");
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return status("working");
  }
  if (thread.session?.status === "starting") return status("connecting");
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return status("failed");
  }
  if (
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  ) {
    return status("planReady");
  }
  if (thread.backgroundLiveness === "working") return status("working");
  if (thread.backgroundLiveness === "monitoring") return status("monitoring");
  if (hasUnseenWake(thread)) return status("woke");
  if (hasUnseenCompletion(thread)) return status("done");
  return status("idle");
}

/**
 * The kind a reader sees for a thread its Mate resolved without a visit (a digest,
 * `@t3tools/shared/mateLink`): the resolver's own answer for this reader. Only `done` and `woke`
 * depend on who looks, both come last, and a digest carries no wake — so an `idle` digest is
 * `done` while its completion is newer than the reader's visit, and every other kind is final.
 */
export function viewerThreadKind(
  digest: { readonly kind: ThreadStatusKind; readonly completedAt: string | null },
  lastVisitedAt: string | null | undefined,
): ThreadStatusKind {
  if (digest.kind !== "idle") return digest.kind;
  return hasUnseenCompletion({ latestTurn: { completedAt: digest.completedAt }, lastVisitedAt })
    ? "done"
    : "idle";
}

/**
 * The face a Mate wears for a thread status. Identity v1 §04 gives the mark
 * four waking states and the resolver has ten kinds, so this is the one place
 * they meet (R5: the status is resolved once; every face is derived from it).
 * Anything that waits on a person — an approval, a question, a plan, a failure,
 * a wake nobody has seen — is "needs you"; anything the agent is doing itself
 * is "working". Asleep is not a thread state: a Mate whose container is not
 * connected has no thread to resolve, and the caller draws it asleep.
 */
export function mateMarkStateForThreadStatus(kind: ThreadStatusKind): MateMarkState {
  switch (kind) {
    case "approval":
    case "input":
    case "planReady":
    case "woke":
    case "failed":
      return "needs";
    case "connecting":
    case "working":
    case "monitoring":
      return "working";
    case "done":
      return "done";
    case "idle":
      return "idle";
  }
}

/**
 * The face for a thread that may be paused at a usage limit
 * (`OrchestrationThreadShell.usagePause`): asleep until the limit resets,
 * whatever its last turn said — it will do nothing before then, and the
 * resume picks its work up without anybody. What waits on a person still
 * does: an approval or a question is answered whether or not the limit has
 * reset. Otherwise the status's own face, from the one mapping above.
 */
export function mateMarkStateForThread(kind: ThreadStatusKind, paused: boolean): MateMarkState {
  if (paused && kind !== "approval" && kind !== "input") return "sleep";
  return mateMarkStateForThreadStatus(kind);
}

export function kindForAwarenessPhase(
  phase: Exclude<RelayAgentAwarenessPhase, "stale">,
): Exclude<ThreadStatusKind, "idle">;
export function kindForAwarenessPhase(phase: "stale"): "idle";
export function kindForAwarenessPhase(phase: RelayAgentAwarenessPhase): ThreadStatusKind;
export function kindForAwarenessPhase(phase: RelayAgentAwarenessPhase): ThreadStatusKind {
  switch (phase) {
    case "waiting_for_approval":
      return "approval";
    case "waiting_for_input":
      return "input";
    case "failed":
      return "failed";
    case "starting":
      return "connecting";
    case "running":
      return "working";
    case "completed":
      return "done";
    case "stale":
      return "idle";
  }
}

// ---------------------------------------------------------------------------
// A run that broke off
// ---------------------------------------------------------------------------

/** What the person does next about a run that broke off: said on the latest run only. */
export const PICK_UP_NEXT = "Send a message to pick up where it left off.";

/** The agent as the person knows it: the product it runs, not its driver's id. */
const AGENT_NAMES: Partial<Record<string, string>> = { claudeAgent: "Claude Code" };

/**
 * What the conversation says when an agent's process died in the middle of
 * its turn, whatever the driver: that it stopped, and what to do next. Its
 * exit code, signal and stderr are the log's, never the person's.
 */
export function agentStoppedUnexpectedly(provider: ProviderDriverKind | string): string {
  const name =
    AGENT_NAMES[provider] ?? PROVIDER_DISPLAY_NAMES[provider as ProviderDriverKind] ?? "The agent";
  return `${name} stopped unexpectedly. ${PICK_UP_NEXT}`;
}

/** What the conversation says of a picture the agent could not be given. */
export const ATTACHED_PICTURE_UNREADABLE =
  "A picture you attached could not be read. Attach it again and send.";

/** What the conversation says of a file the agent could not be given. */
export const ATTACHED_FILE_UNREADABLE =
  "A file you attached could not be read. Attach it again and send.";

/** The trailing sentence that says what to do next about a run that broke off. */
const NEXT_STEP = /\s*[^.!?]*pick up where it left off\.$/u;

/**
 * Why a run broke off, without what to do next: an earlier run, once a later
 * one followed, says only what happened ("Codex stopped unexpectedly.").
 */
export function brokeOffReason(words: string): string {
  const reason = words.replace(NEXT_STEP, "").trim();
  return reason.length > 0 ? reason : words;
}
