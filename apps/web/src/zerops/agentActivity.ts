/**
 * What each Mate is up to, one answer per environment.
 *
 * An environment is one conversation (`resolvePrimaryConversation`), and that
 * conversation's status is the agent's: run through `resolveThreadStatus`,
 * the one status resolver, and `threadStatusPill`, the one phrase producer
 * (R5), so a Mate's row, a Mate's card and a thread's row can never disagree
 * about what "working" looks like. The face comes from the same status
 * (`mateMarkStateForThreadStatus`), and the subject — what it is on, or was
 * last on — is the running plan step while a turn runs and the server
 * reports one, else the last task as the person put it (the shell's
 * server-kept preview of their last message), which stays up while the Mate
 * is idle: a row that only ever said "Idle" told nobody which Mate this is.
 * The conversation's title is the fallback for a server that keeps no
 * preview — with one conversation per environment it names the first task,
 * forever. The snippet is the Mate's last words, off the same shell.
 * Nothing is decided here; it is all read off the one resolver.
 *
 * Knowable only for an environment Mate is connected to: an environment with
 * no thread shells has no entry, and the caller draws it asleep.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusKind,
} from "@t3tools/shared/threadStatus";

import { threadStatusPill, type ThreadStatusPill } from "../components/Sidebar.logic";

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
}

export function agentActivitySnippet(
  thread: Pick<EnvironmentThreadShell, "latestMessagePreview">,
): string | undefined {
  const preview = thread.latestMessagePreview;
  if (preview === undefined || preview === null || preview.role !== "assistant") return undefined;
  return preview.text;
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
    if (step !== undefined && step.length > 0) return step;
  }
  // The last task, as the person put it.
  const asked = thread.latestUserMessagePreview;
  if (asked !== undefined && asked !== null) return asked.text;
  // A conversation nobody has spoken into has a placeholder for a title, not
  // a subject: a Mate that was never asked anything has nothing it is about.
  if (thread.latestUserMessageAt === null) return undefined;
  const title = thread.title.trim();
  return title.length > 0 ? title : undefined;
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
    const lastVisitedAt =
      lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, primary.id))];
    const resolved = resolveThreadStatus({
      ...primary,
      ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }),
    });
    activity.set(environmentId, {
      threadId: primary.id,
      kind: resolved.kind,
      status: threadStatusPill(resolved),
      face: mateMarkStateForThreadStatus(resolved.kind),
      subject: agentActivitySubject(primary, resolved.kind),
      at: agentActivityAt(primary),
      snippet: agentActivitySnippet(primary),
    });
  }
  return activity;
}
