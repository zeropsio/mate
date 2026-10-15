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

/**
 * How long a listed conversation's opening waits for its messages before the conversation opens
 * from its list entry (its header, its own "Loading messages…", a composer ready). Three times the
 * beat after which the opening says its line (`OPENING_WAIT_LINE_MS`): a reload's list entry and
 * messages come over the Mate's one socket, so messages not here by then are not coming soon — a
 * Mate stopped, a connection blocked — and the person gets a composer rather than a stage.
 */
export const THREAD_READ_PATIENCE_MS = 3_000;

/** What a thread's route draws: the Mate's opening, the conversation, its absence, or nothing. */
export type ThreadRouteStage = "opening" | "conversation" | "missing" | "quiet";

/**
 * The thread route's stage. Arriving (no conversation on screen yet in this pane), it holds the
 * Mate's opening until the conversation's messages are read, so the conversation's first frame is
 * whole — header, messages and composer at once — rather than a header over an empty pane. A pane
 * already showing a conversation keeps it while the next one's messages are read (it repaints that
 * thread's last timeline meanwhile). Arriving, it also waits for HQ's answer, which names the
 * header and adds rows of its own. Where nobody lives, there is no Mate's view to hold; where the
 * messages or HQ's answer do not come, the opening hands over after a short wait.
 */
export function resolveThreadRouteStage(input: {
  readonly renderState: ThreadRouteRenderState;
  readonly serverThreadShellExists: boolean;
  /** This pane has shown a conversation since the route mounted. */
  readonly conversationShown: boolean;
  /** The directory has decided no Mate lives in the route's environment. */
  readonly nobodyLivesHere: boolean;
  /**
   * Waiting on its messages is over: their read failed, or `THREAD_READ_PATIENCE_MS` passed since
   * the list named the thread.
   */
  readonly readGivenUp: boolean;
  /**
   * HQ has answered for the directory (or refused, or stopped being asked often): until then the
   * header's identity and the rows HQ's facts add are the last visit's, and land after the reveal.
   */
  readonly directoryAnswered: boolean;
  /** The conversation is a draft just promoted on this screen: it is on screen already. */
  readonly promotedDraft: boolean;
}): ThreadRouteStage {
  const arriving =
    !input.conversationShown &&
    !input.promotedDraft &&
    !input.nobodyLivesHere &&
    !input.directoryAnswered &&
    !input.readGivenUp;
  if (input.renderState === "ready") return arriving ? "opening" : "conversation";
  if (input.renderState === "missing") return "missing";
  if (
    input.serverThreadShellExists &&
    (input.conversationShown || input.nobodyLivesHere || input.readGivenUp)
  ) {
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
