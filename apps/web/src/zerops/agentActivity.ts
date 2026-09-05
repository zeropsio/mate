/**
 * What each Mate is up to, one answer per environment.
 *
 * An environment is one conversation (`resolvePrimaryConversation`), and that
 * conversation's status is the agent's: run through `resolveThreadStatus`,
 * the one status resolver, and `threadStatusPill`, the one phrase producer
 * (R5), so a Mate's row, a Mate's card and a thread's row can never disagree
 * about what "working" looks like. The face comes from the same status
 * (`mateMarkStateForThreadStatus`), and the subject — what it is working on —
 * is the running plan step when the server reports one, else the
 * conversation's title. Nothing is decided here; it is all read off the one
 * resolver.
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
   * What the Mate is on: the running plan step, else the conversation's title.
   * Absent when idle — an idle Mate is not "working on" the thing it last did.
   */
  readonly subject: string | undefined;
}

export function agentActivitySubject(
  thread: Pick<EnvironmentThreadShell, "title" | "planProgress">,
  kind: ThreadStatusKind,
): string | undefined {
  if (kind === "idle") return undefined;
  const step = thread.planProgress?.step.trim();
  if (step !== undefined && step.length > 0) return step;
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
    });
  }
  return activity;
}
