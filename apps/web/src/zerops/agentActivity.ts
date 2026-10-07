/**
 * What each Mate is up to, one answer per environment.
 *
 * The environment's answer is its main chat's (`resolvePrimaryConversation`),
 * and that chat's status is the agent's: run through `resolveThreadStatus`,
 * the one status resolver, and `threadStatusPill`, the one phrase producer
 * (R5), so a Mate's row, a Mate's card and a thread's row can never disagree
 * about what "working" looks like. The face comes from the same status
 * (`mateMarkStateForThreadStatus`), and the subject — what it is on, or was
 * last on — is the running plan step while a turn runs and the server
 * reports one, else the last task as the person put it (the shell's
 * server-kept preview of the ask that started the latest run — a follow-up
 * sent into a running turn is not the task; a server from before it told the
 * two apart keeps their last ask), which stays up while the Mate is idle: a
 * row that only ever said "Idle" told nobody which Mate this is.
 * The chat's title is the fallback for a server that keeps no preview — it
 * names the chat's first task, forever. The snippet is the Mate's last words,
 * off the same shell. `threadAgentActivity` gives the same answer for any one
 * chat, so the header of a second chat speaks for that chat.
 * Nothing is decided here; it is all read off the one resolver.
 *
 * Read off a chat's shell where this page holds one, or off HQ's overview of a Mate's main chat
 * (`@t3tools/shared/mateLink`), which carries the fields a row reads and no more
 * (`AgentActivityThread`). A Mate with neither has no entry, and the caller draws it asleep.
 */
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  isSlashCommand,
  isUsageLimitResumePrompt,
} from "@t3tools/shared/userAsk";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  candidateContainerRuns,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  mateNextStep,
  matePose,
  resolvePrimaryConversation,
  type FlowPullRequest,
  type MatePoseFacts,
  type MateRunFacts,
} from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentId,
  OrchestrationLatestTurn,
  OrchestrationSession,
  ThreadId,
  ThreadLiveStep,
  ThreadMessagePreview,
} from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import {
  hasUnseenCompletion,
  mateMarkStateForThread,
  resolveThreadStatus,
  type ThreadStatusKind,
} from "@t3tools/shared/threadStatus";

import { threadStatusPill, type ThreadStatusPill } from "../components/Sidebar.logic";
import { usageLimitProvider } from "./noticeWords";
import { liveStepWords, type LiveStepWords } from "./liveStep";

/**
 * What a row reads of a chat: its shell's fields, of which HQ's overview of a Mate's main chat
 * carries exactly these — its turn's and session's bare facts, its previews' words.
 */
export type AgentActivityThread = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "title"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "backgroundLiveness"
  | "latestUserMessageAt"
  | "updatedAt"
> & {
  readonly session: {
    readonly status: OrchestrationSession["status"];
    readonly lastError: string | null;
    readonly providerName?: string | null;
  } | null;
  readonly latestTurn: Pick<
    OrchestrationLatestTurn,
    "turnId" | "state" | "requestedAt" | "startedAt" | "completedAt"
  > | null;
  readonly latestUserMessagePreview?: { readonly text: string } | null | undefined;
  readonly latestMessagePreview?: Pick<ThreadMessagePreview, "role" | "text"> | null | undefined;
  readonly planProgress?: { readonly step: string } | null | undefined;
  readonly pendingQuestion?: string | null | undefined;
  readonly usagePause?: { readonly resetsAt: string } | null | undefined;
  readonly liveStep?: ThreadLiveStep | null | undefined;
};

export interface ZeropsAgentActivity {
  readonly threadId: ThreadId;
  readonly kind: ThreadStatusKind;
  /**
   * The status word and its tone, as the thread rows phrase it. Null when
   * idle: the phrase producer has no word for a thread with nothing going on,
   * and a Mate's row says "Idle" in its own voice.
   */
  readonly status: ThreadStatusPill | null;
  readonly face: MateMarkState;
  /**
   * What the Mate is on, or was last on: the running plan step while it
   * works, else the last task as the person asked it — idle included, so the
   * line under the name keeps saying what this Mate is about. The
   * conversation's title only on a server that keeps no preview. Absent for
   * a conversation nobody has spoken into yet.
   */
  readonly subject: string | undefined;
  /**
   * When the Mate last did something: the last turn's end while it rests, its
   * start while it works, else the conversation's last change. What a row
   * writes at its right edge, the way a messenger dates its rows.
   */
  readonly at: string;
  /**
   * The Mate's last words, quoted under the task — the reply to what the
   * subject asks. Absent while the person's message is the last thing said
   * (the subject already says it), and on a server that keeps no preview.
   */
  readonly snippet: string | undefined;
  /**
   * The person's words are the last thing said and the run answering them
   * has not ended (`agentActivityAwaitsWords`): where the last words will
   * stand, the row holds its line for them.
   */
  readonly awaitingWords?: true;
  /**
   * The step the Mate is on right now, in the words its run's now line uses:
   * what the menu's third line says while it works. The server relays it;
   * absent where it relays none, and the row holds its dots.
   */
  readonly liveStep?: LiveStepWords;
  /**
   * Its turn is over and the helpers it launched work on (`agentActivityWaitsOnHelpers`): its run
   * card waits on them, and its row says so in the card's words, its clock stopped with its turn.
   */
  readonly waitsOnHelpers?: true;
  /**
   * The question the Mate waits on the person to answer, in its words: what a
   * needs-you row's third line says. The server relays it; absent while
   * nothing waits, or where it relays none (the row keeps its last words).
   */
  readonly question?: string | undefined;
  /** The first line of the error the Mate stopped on: a failed row's third line. */
  readonly errorLine?: string | undefined;
  /**
   * The Mate finished something this device has not looked at since
   * (`hasUnseenCompletion`, the resolver's own fact): its row's name is at
   * 600 and a blue dot stands before its age until its conversation is
   * opened.
   */
  readonly unread: boolean;
  /** When the usage limit pausing it resets; absent while it is not paused. */
  readonly pausedUntil: string | undefined;
  /** A provider refusal can prove a limit without knowing its reset. */
  readonly usageLimited?: boolean;
  readonly limitProvider?: string | undefined;
  /** Held source state is distinct from the current activity; it grants no actions. */
  readonly lastKnown?: Pick<
    ZeropsAgentActivity,
    "kind" | "at" | "usageLimited" | "pausedUntil" | "limitProvider" | "errorLine"
  >;
  /** The conversation's scoped key — what its unsent draft is kept under. */
  readonly threadKey: string;
  /**
   * The last task as the person asked it, whatever the subject says
   * meanwhile — the menu row's second line while the subject names the step
   * the Mate is on.
   */
  readonly task: string | undefined;
  /**
   * When the person last wrote into it: the time their own browser stamped
   * on the message, so a browser holding what it sent (`sentAsk.ts`) knows
   * the echo by its own clock.
   */
  readonly askedAt?: string;
  /**
   * Not a word of now (`restingActivity`): HQ's last word of a Mate it holds no live link of, or a
   * reading whose socket does not stand — its words and its time, at rest, with nothing only true
   * then.
   */
  readonly remembered?: true;
}

/**
 * The face a Mate wears wherever it is named — a row, a card, a conversation's
 * header, its home on the map. Asleep until its container is connected: a Mate
 * is known from its project's tags and its container's origin, seconds before
 * there is any conversation to resolve.
 * Connected with nothing resolved yet is idle, the floor of the same rule.
 *
 * Its pose for where it is in its life (`matePose`) is read here and nowhere else: waking while
 * it comes up and arrives (`mateArriving`), asleep where it did not come or while it goes. A
 * surface that draws a Mate passes what it knows of that (`pose`); without it, it is settled.
 */
export function mateFaceFor(
  connected: boolean,
  activity: Pick<ZeropsAgentActivity, "face"> | undefined,
  pose?: MatePoseFacts,
): MateMarkState {
  return matePose(connected ? (activity?.face ?? "idle") : "sleep", pose);
}

/**
 * The face of a Mate being created that the listing does not hold yet (`GroupFlowComing`), on
 * every surface that draws one: waking while it comes up, asleep once its birth stopped.
 */
export function mateBirthFace(failed: boolean): MateMarkState {
  return mateFaceFor(false, undefined, { life: failed ? "failed" : "coming" });
}

/**
 * The face a Mate wears for the viewer — the one rule of "waits on you", on every surface that
 * draws it (a row's face and amber dot, a folded heading, the waiting stack, the projects pages):
 *
 * | whose Mate            | its question waits | its change waits (`mateReviewWaits`) |
 * | --------------------- | ------------------ | ------------------------------------ |
 * | the viewer's own      | needs you          | needs you, unless at work            |
 * | another's, or nobody's | at rest            | at rest                              |
 *
 * Own is HQ saying it waits on the viewer, who signed its agent in (`waitsOnViewer`). Another's Mate waits on its
 * owner, not on the viewer: it claims nothing of them here, though its change stays on its row
 * with its Review, for anybody with write on the group to review and merge. At work, the work
 * shows; the review still waits under it.
 */
export function mateFaceAwaitingReview(
  face: MateMarkState,
  reviewWaits: boolean,
  /**
   * Paused at its usage limit (`pausedUntil`): asleep, whatever its last turn said — its row
   * reads paused, and the review stays on its change's row under it.
   */
  paused: boolean,
  /** The viewer's own Mate (HQ's `waitsOnViewer`): only then does anything it waits on wait on them. */
  mine: boolean,
): MateMarkState {
  if (paused && face === "sleep") return face;
  if (!mine) return face === "needs" ? "idle" : face;
  return reviewWaits && face !== "working" ? "needs" : face;
}

/**
 * Whether a Mate's own change waits on the person's review: the composer's top's rule
 * (`mateNextStep`), on a project flow HQ answered — the one reading of it for every surface
 * that draws the Mate's face.
 */
export function mateReviewWaits(
  flow:
    | {
        readonly pullRequests: ReadonlyArray<FlowPullRequest>;
        /** Absent reads as answered. */
        readonly changesKnown?: boolean | undefined;
      }
    | undefined,
  mateProjectId: string,
): boolean {
  if (flow === undefined || flow.changesKnown === false) return false;
  return (
    mateNextStep({ pullRequests: flow.pullRequests, mateProjectId, mateName: undefined }).kind ===
    "review"
  );
}

/**
 * Whether a Mate's face is awake before any word of what it does: its container runs
 * (`candidateContainerRuns` — this tab's socket to it, or ready while that socket is not open yet),
 * or HQ holds one of its links open. The one rule of the menu's rows and headings and the project
 * page's Mates, so a reload or an HQ outage never draws a running Mate asleep on one and awake on
 * the other.
 */
export function mateAwake(
  item: Pick<ZeropsCandidate, "group"> & {
    readonly project: Pick<ZeropsCandidate["project"], "id">;
  },
  mates: ReadonlyMap<string, Pick<MateLiveView, "presence">> | null | undefined,
): boolean {
  return candidateContainerRuns(item) || mates?.get(item.project.id)?.presence.online === true;
}

/**
 * The face a Mate wears wherever it is drawn (`mateFaceFor`), from what is known of it: awake while
 * its container is connected or a word of now says what it does — HQ's live word, a standing
 * socket's reading; a word at rest says nothing of now — and needing the person while its own
 * change waits for their review (`mateFaceAwaitingReview`).
 */
export function mateFaceOf(input: {
  readonly connected: boolean;
  readonly activity:
    | (Pick<ZeropsAgentActivity, "face" | "remembered"> & {
        readonly pausedUntil?: string | undefined;
        readonly usageLimited?: boolean;
      })
    | undefined;
  readonly reviewWaits: boolean;
  /** The viewer's own Mate (HQ's `waitsOnViewer`). */
  readonly mine: boolean;
  /** Where it is in its life (`mateFaceFor`). */
  readonly pose?: MatePoseFacts | undefined;
}): MateMarkState {
  const live = input.activity?.remembered === true ? undefined : input.activity;
  return mateFaceAwaitingReview(
    mateFaceFor(input.connected || live !== undefined, live, input.pose),
    input.reviewWaits,
    live?.usageLimited === true || live?.pausedUntil !== undefined,
    input.mine,
  );
}

export function agentActivitySnippet(
  thread: Pick<AgentActivityThread, "latestMessagePreview">,
): string | undefined {
  const preview = thread.latestMessagePreview;
  if (preview === undefined || preview === null || preview.role !== "assistant") return undefined;
  // A server from before previews were masked still hands over what was pasted.
  return maskSecrets(preview.text);
}

/**
 * The person's words are the last thing said and no run has ended since they
 * were sent: the Mate is on them, or about to be — its last run over and the
 * next not running yet, the second after a message is sent.
 */
export function agentActivityAwaitsWords(
  thread: Pick<AgentActivityThread, "latestMessagePreview" | "latestUserMessageAt" | "latestTurn">,
): boolean {
  const said = thread.latestMessagePreview;
  if (said === undefined || said === null || said.role === "assistant") return false;
  const asked = thread.latestUserMessageAt;
  if (asked === null) return false;
  const ended = thread.latestTurn?.completedAt ?? null;
  return ended === null || Date.parse(ended) < Date.parse(asked);
}

export function agentActivityAt(
  thread: Pick<AgentActivityThread, "latestTurn" | "latestUserMessageAt" | "updatedAt">,
): string {
  const turn = thread.latestTurn;
  return (
    turn?.completedAt ??
    turn?.startedAt ??
    turn?.requestedAt ??
    thread.latestUserMessageAt ??
    thread.updatedAt
  );
}

export function agentActivitySubject(
  thread: Pick<
    AgentActivityThread,
    "title" | "planProgress" | "latestUserMessageAt" | "latestUserMessagePreview"
  >,
  kind: ThreadStatusKind,
): string | undefined {
  if (kind !== "idle") {
    const step = thread.planProgress?.step.trim();
    if (step !== undefined && step.length > 0) return maskSecrets(step);
  }
  // The last task, as the person put it — never a command to the harness or
  // the client's own placeholder for an image-only message, which a server
  // from before it knew better may still hand over as the latest words.
  const asked = thread.latestUserMessagePreview;
  if (asked !== undefined && asked !== null && isPersonsWords(asked.text)) {
    return maskSecrets(asked.text);
  }
  // A conversation nobody has spoken into has a placeholder for a title, not
  // a subject: a Mate that was never asked anything has nothing it is about.
  if (thread.latestUserMessageAt === null) return undefined;
  const title = thread.title.trim();
  return title.length > 0 && isPersonsWords(title) ? maskSecrets(title) : undefined;
}

function isPersonsWords(text: string): boolean {
  const trimmed = text.trim();
  return (
    !isSlashCommand(trimmed) &&
    !isUsageLimitResumePrompt(trimmed) &&
    trimmed !== IMAGE_ONLY_BOOTSTRAP_PROMPT
  );
}

/**
 * What the Mate is up to in one chat: the same answer the environment's
 * entry gives for its main chat, for any chat — a conversation's header
 * speaks for the chat it heads.
 */
export function threadAgentActivity(
  thread: AgentActivityThread,
  lastVisitedAt: string | undefined,
): ZeropsAgentActivity {
  // A shell is immutable, and kept while nothing in it changes: every Mate read again on each
  // event of one streaming chat reads its own unchanged shell.
  const known = activityByThread.get(thread);
  if (known !== undefined && known.lastVisitedAt === lastVisitedAt) return known.activity;
  const activity = readThreadAgentActivity(thread, lastVisitedAt);
  activityByThread.set(thread, { lastVisitedAt, activity });
  return activity;
}

const activityByThread = new WeakMap<
  AgentActivityThread,
  { readonly lastVisitedAt: string | undefined; readonly activity: ZeropsAgentActivity }
>();

function readThreadAgentActivity(
  thread: AgentActivityThread,
  lastVisitedAt: string | undefined,
): ZeropsAgentActivity {
  const visited = lastVisitedAt === undefined ? {} : { lastVisitedAt };
  const resolved = resolveThreadStatus({ ...thread, ...visited });
  const pause = thread.usagePause ?? undefined;
  const usageLimited =
    pause !== undefined || usageLimitProvider(thread.session?.lastError) !== null;
  return {
    threadId: thread.id,
    kind: resolved.kind,
    status: threadStatusPill(resolved),
    face: mateMarkStateForThread(resolved.kind, usageLimited),
    subject: agentActivitySubject(thread, resolved.kind),
    at: agentActivityAt(thread),
    snippet: agentActivitySnippet(thread),
    ...(agentActivityAwaitsWords(thread) ? { awaitingWords: true as const } : {}),
    unread: hasUnseenCompletion({ latestTurn: thread.latestTurn, ...visited }),
    pausedUntil: pause?.resetsAt,
    usageLimited,
    limitProvider: usageLimited
      ? (usageLimitProvider(thread.session?.lastError) ??
        (pause && thread.session?.providerName === "claudeAgent"
          ? "Claude"
          : pause && thread.session?.providerName === "codex"
            ? "Codex"
            : undefined))
      : undefined,
    threadKey: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    task: agentActivitySubject(thread, "idle"),
    ...(thread.latestUserMessageAt === null ? {} : { askedAt: thread.latestUserMessageAt }),
    ...agentActivityLiveStep(thread, resolved.kind),
    ...(agentActivityWaitsOnHelpers(thread, resolved.kind)
      ? { waitsOnHelpers: true as const }
      : {}),
    ...agentActivityQuestion(thread, resolved.kind),
    ...agentActivityErrorLine(thread, resolved.kind),
  };
}

/**
 * Whether it works only on its helpers: no turn runs, and the server holds
 * helpers live (run 11, D8: the menu read "Working on a reply" while the
 * card said "Waiting for its helpers").
 */
export function agentActivityWaitsOnHelpers(
  thread: Pick<AgentActivityThread, "backgroundLiveness" | "session" | "latestTurn">,
  kind: ThreadStatusKind,
): boolean {
  return (
    kind === "working" &&
    thread.backgroundLiveness === "working" &&
    thread.session?.status !== "running" &&
    thread.latestTurn?.state !== "running"
  );
}

/**
 * The step it is on, in its run card's words (`liveStep.ts`), while it
 * works and its server relays one. A server from before it relays none: the
 * row holds its dots.
 */
export function agentActivityLiveStep(
  thread: Pick<AgentActivityThread, "liveStep">,
  kind: ThreadStatusKind,
): { readonly liveStep?: LiveStepWords } {
  const step = thread.liveStep ?? undefined;
  if (kind !== "working" || step === undefined) return {};
  return { liveStep: liveStepWords(step) };
}

/**
 * The question it waits on the person to answer, while that is what it
 * waits on — an approval waiting first is no question. Quoted by the server
 * the way a preview is; a server from before it relays none.
 */
export function agentActivityQuestion(
  thread: Pick<AgentActivityThread, "pendingQuestion">,
  kind: ThreadStatusKind,
): { readonly question?: string } {
  if (kind !== "input") return {};
  const question = thread.pendingQuestion?.trim();
  return question === undefined || question.length === 0 ? {} : { question };
}

/**
 * The error's first line, while the Mate stands stopped on it; a sign-in failure in the row's
 * words — under the Mate's name, what the person signs in to (`mateErrorWords`).
 */
export function agentActivityErrorLine(
  thread: Pick<AgentActivityThread, "session">,
  kind: ThreadStatusKind,
): { readonly errorLine?: string } {
  if (kind !== "failed" && usageLimitProvider(thread.session?.lastError) === null) return {};
  const first = thread.session?.lastError
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (first === undefined) return {};
  return { errorLine: maskSecrets(first) };
}

export function deriveZeropsAgentActivity(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  lastVisitedAtById: Readonly<Record<string, string>>,
): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const shellsByEnvironment = new Map<EnvironmentId, Array<EnvironmentThreadShell>>();
  for (const thread of threads) {
    const shells = shellsByEnvironment.get(thread.environmentId);
    if (shells) shells.push(thread);
    else shellsByEnvironment.set(thread.environmentId, [thread]);
  }

  const activity = new Map<EnvironmentId, ZeropsAgentActivity>();
  for (const [environmentId, shells] of shellsByEnvironment) {
    const { primary } = resolvePrimaryConversation(shells);
    if (primary === undefined) continue;
    activity.set(
      environmentId,
      threadAgentActivity(
        primary,
        lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, primary.id))],
      ),
    );
  }
  return activity;
}

/**
 * An activity as last told, with nothing only true now — at rest, no status, no step, no
 * error, no pause — so no clock ticks and no *Stop* is offered from it. Its last-known question
 * stays readable beside the source's stale indication until a newer answer replaces it.
 */
export function restingActivity(
  activity: ZeropsAgentActivity,
  at = activity.at,
): ZeropsAgentActivity {
  if (activity.remembered === true) return activity;
  const { liveStep: _step, waitsOnHelpers: _helpers, errorLine: _error, ...words } = activity;
  return {
    ...words,
    kind: "idle",
    status: null,
    face: "idle",
    pausedUntil: undefined,
    usageLimited: false,
    remembered: true,
    limitProvider: undefined,
    lastKnown: {
      kind: activity.kind,
      at,
      usageLimited: activity.usageLimited === true,
      pausedUntil: activity.pausedUntil,
      limitProvider: activity.limitProvider,
      errorLine: activity.errorLine,
    },
  };
}

/** A Mate as a change's *Review* reads it (`changeShowsReview`), from its activity of now. */
export function mateRunOf(activity: ZeropsAgentActivity | undefined): MateRunFacts | undefined {
  return activity?.face === "working" ? { working: true } : undefined;
}

/**
 * The activity, where it is a word of now — HQ's live word, a standing socket's reading — and not
 * one at rest (`restingActivity`), which says nothing of what the Mate does now.
 */
export function activityOfNow(
  activity: ZeropsAgentActivity | undefined,
): ZeropsAgentActivity | undefined {
  return activity?.remembered === true ? undefined : activity;
}

/**
 * A Mate's activity from HQ's overview of it: its main chat read as its shell is, with this
 * device's visit — at rest unless HQ's word is live (`restingActivity`). Undefined where HQ holds
 * no overview of it, or it has no main chat yet.
 */
export function overviewAgentActivity(
  mate: MateLiveView,
  live: boolean,
  lastVisitedAtById: Readonly<Record<string, string>>,
): ZeropsAgentActivity | undefined {
  if (mate.identity === undefined || !mate.main) return undefined;
  const { environmentId } = mate.identity;
  const activity = threadAgentActivity(
    { ...mate.main, environmentId },
    lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, mate.main.id))],
  );
  return live ? activity : restingActivity(activity, mate.main.updatedAt);
}
