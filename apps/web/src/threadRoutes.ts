import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "./composerDraftStore";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

type DraftThreadRouteState = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  promotedTo?: ScopedThreadRef | null;
};

export type ThreadRouteRenderState = "loading" | "ready" | "missing";

/**
 * The thread gate (DESIGN §4.8): the thread is missing only when its environment's shell is
 * `live` and lacks it, or when the server deleted its detail. A shell that is empty, cached or
 * still synchronizing proves nothing absent, so the route waits on its environment's
 * reachability, which the route gate above it shows.
 */
export function resolveThreadRouteRenderState(input: {
  shell: EnvironmentShellStatus;
  serverThreadShellExists: boolean;
  serverThreadDetailExists: boolean;
  serverThreadDetailDeleted: boolean;
  draftThreadExists: boolean;
}): ThreadRouteRenderState {
  if (input.serverThreadDetailExists || input.draftThreadExists) {
    return "ready";
  }
  if (input.serverThreadDetailDeleted) {
    return "missing";
  }
  return input.shell === "live" && !input.serverThreadShellExists ? "missing" : "loading";
}

/** What a thread's route draws: the Mate's opening, the conversation, its absence, or nothing. */
export type ThreadRouteStage = "opening" | "conversation" | "missing" | "quiet";

/**
 * The thread route's stage. Arriving (no conversation on screen yet in this pane), it holds the
 * Mate's opening until the conversation's messages are read, so the conversation's first frame is
 * whole — header, messages and composer at once — rather than a header over an empty pane. A pane
 * already showing a conversation keeps it while the next one's messages are read (it repaints that
 * thread's last timeline meanwhile). Where nobody lives, there is no Mate's view to hold.
 */
export function resolveThreadRouteStage(input: {
  readonly renderState: ThreadRouteRenderState;
  readonly serverThreadShellExists: boolean;
  /** This pane has shown a conversation since the route mounted. */
  readonly conversationShown: boolean;
  /** The directory has decided no Mate lives in the route's environment. */
  readonly nobodyLivesHere: boolean;
}): ThreadRouteStage {
  if (input.renderState === "ready") return "conversation";
  if (input.renderState === "missing") return "missing";
  if (input.serverThreadShellExists && (input.conversationShown || input.nobodyLivesHere)) {
    return "conversation";
  }
  return input.nobodyLivesHere ? "quiet" : "opening";
}

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

export function resolveThreadRouteRef(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId);
}

export function resolveThreadRouteTarget(
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
): ThreadRouteTarget | null {
  if (params.environmentId && params.threadId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}

/**
 * Resolves the thread represented by either a canonical thread route or a
 * draft route whose promotion to a server thread has been recorded.
 */
export function resolveActiveThreadRouteRef(
  target: ThreadRouteTarget | null,
  draftThread: DraftThreadRouteState | null,
): ScopedThreadRef | null {
  if (target?.kind === "server") {
    return target.threadRef;
  }
  if (target?.kind !== "draft" || !draftThread?.promotedTo) {
    return null;
  }
  return draftThread.promotedTo;
}
