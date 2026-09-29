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
 * Knowable only for an environment Mate is connected to: an environment with
 * no thread shells has no entry, and the caller draws it asleep.
 */
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  isSlashCommand,
  isUsageLimitResumePrompt,
} from "@t3tools/shared/userAsk";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import {
  hasUnseenCompletion,
  mateMarkStateForThread,
  resolveThreadStatus,
  type ThreadStatusKind,
} from "@t3tools/shared/threadStatus";

import { threadStatusPill, type ThreadStatusPill } from "../components/Sidebar.logic";
import { liveStepWords, type LiveStepWords } from "./liveStep";

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
  /** The conversation's scoped key — what its unsent draft is kept under. */
  readonly threadKey: string;
  /**
   * The last task as the person asked it, whatever the subject says
   * meanwhile — the menu row's second line while the subject names the step
   * the Mate is on.
   */
  readonly task: string | undefined;
  /**
   * What this browser remembered the row saying (`menuMemory.ts`), standing
   * until the Mate's own conversation is read: its words and its time, at
   * rest, with nothing only true now.
   */
  readonly remembered?: true;
}

/**
 * The face a Mate wears wherever it is named — a row, a card, a conversation's
 * header, its home on the map. Asleep until its container is connected: a Mate
 * is known from its project's tags and its container's origin, seconds before
 * there is any conversation to resolve.
 * Connected with nothing resolved yet is idle, the floor of the same rule.
 */
export function mateFaceFor(
  connected: boolean,
  activity: Pick<ZeropsAgentActivity, "face"> | undefined,
): MateMarkState {
  if (!connected) return "sleep";
  return activity?.face ?? "idle";
}

export function agentActivitySnippet(
  thread: Pick<EnvironmentThreadShell, "latestMessagePreview">,
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
  thread: Pick<
    EnvironmentThreadShell,
    "latestMessagePreview" | "latestUserMessageAt" | "latestTurn"
  >,
): boolean {
  const said = thread.latestMessagePreview;
  if (said === undefined || said === null || said.role === "assistant") return false;
  const asked = thread.latestUserMessageAt;
  if (asked === null) return false;
  const ended = thread.latestTurn?.completedAt ?? null;
  return ended === null || Date.parse(ended) < Date.parse(asked);
}

export function agentActivityAt(
  thread: Pick<EnvironmentThreadShell, "latestTurn" | "latestUserMessageAt" | "updatedAt">,
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
    EnvironmentThreadShell,
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
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
): ZeropsAgentActivity {
  const visited = lastVisitedAt === undefined ? {} : { lastVisitedAt };
  const resolved = resolveThreadStatus({ ...thread, ...visited });
  const pause = thread.usagePause ?? undefined;
  return {
    threadId: thread.id,
    kind: resolved.kind,
    status: threadStatusPill(resolved),
    face: mateMarkStateForThread(resolved.kind, pause !== undefined),
    subject: agentActivitySubject(thread, resolved.kind),
    at: agentActivityAt(thread),
    snippet: agentActivitySnippet(thread),
    ...(agentActivityAwaitsWords(thread) ? { awaitingWords: true as const } : {}),
    unread: hasUnseenCompletion({ latestTurn: thread.latestTurn, ...visited }),
    pausedUntil: pause?.resetsAt,
    threadKey: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    task: agentActivitySubject(thread, "idle"),
    ...agentActivityLiveStep(thread, resolved.kind),
    ...agentActivityQuestion(thread, resolved.kind),
    ...agentActivityErrorLine(thread, resolved.kind),
  };
}

/**
 * The step it is on, in its run card's words (`liveStep.ts`), while it
 * works and its server relays one. A server from before it relays none: the
 * row holds its dots.
 */
export function agentActivityLiveStep(
  thread: Pick<EnvironmentThreadShell, "liveStep">,
  kind: ThreadStatusKind,
): { readonly liveStep?: LiveStepWords } {
  if (kind !== "working" || thread.liveStep === undefined) return {};
  return { liveStep: liveStepWords(thread.liveStep) };
}

/**
 * The question it waits on the person to answer, while that is what it
 * waits on — an approval waiting first is no question. Quoted by the server
 * the way a preview is; a server from before it relays none.
 */
export function agentActivityQuestion(
  thread: Pick<EnvironmentThreadShell, "pendingQuestion">,
  kind: ThreadStatusKind,
): { readonly question?: string } {
  if (kind !== "input") return {};
  const question = thread.pendingQuestion?.trim();
  return question === undefined || question.length === 0 ? {} : { question };
}

/** The error's first line, while the Mate stands stopped on it. */
export function agentActivityErrorLine(
  thread: Pick<EnvironmentThreadShell, "session">,
  kind: ThreadStatusKind,
): { readonly errorLine?: string } {
  if (kind !== "failed") return {};
  const first = thread.session?.lastError
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first === undefined ? {} : { errorLine: maskSecrets(first) };
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
