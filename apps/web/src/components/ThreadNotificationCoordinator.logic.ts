/**
 * What rings, over the Mates the person may observe: a pure fold the coordinator runs on every
 * change of what is known of them. A Mate that publishes its attention rings off it — what it waits
 * on its person for, the turns it finished — while that word is of now; one from before it, off
 * HQ's overview of its chats while HQ's view is current.
 *
 * @module ThreadNotificationCoordinator.logic
 */
import type { EnvironmentId, MateAttention, ThreadId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { MateThreadKind } from "@t3tools/shared/mateLink";

/** One chat of a Mate as the watch reads it. */
export interface WatchedThread {
  readonly id: ThreadId;
  readonly title: string;
  readonly status: MateThreadKind;
  /** What it waits on its person for, once per turn and kind (`turnId:kind`); none otherwise. */
  readonly attention: string | null;
  /** When its last turn completed, where it rests on it; `null` says nothing of it. */
  readonly completedAt: number | null;
}

/** A Mate as the watch reads it: its environment and its chats. */
export interface WatchedMate {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<WatchedThread>;
}

/** One thread as the last look left it. */
interface ThreadMark {
  readonly attention: string | null;
  readonly completion: number | null;
}

/** What the watch keeps between looks, by the Mate's project. */
export type MatesBaseline = ReadonlyMap<
  string,
  { readonly since: number; readonly threads: ReadonlyMap<ThreadId, ThreadMark> }
>;

/** A thread that rings: something it waits on the person for, or a turn it completed. */
export interface ThreadRing {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly kind: "input" | "completion";
  readonly status: MateThreadKind;
}

/** A thread no longer on its way: none of what a turn does, nor waits on the person for. */
const SETTLED: ReadonlySet<MateThreadKind> = new Set(["failed", "planReady", "monitoring", "idle"]);

/** What the person is waited on for: a question, an approval or a failure, once per turn. */
const ATTENTION: ReadonlySet<MateThreadKind> = new Set(["input", "approval", "failed"]);

/** A Mate from before the attention value, off HQ's overview of its chats. */
export function overviewWatch(view: MateLiveView): WatchedMate | undefined {
  if (view.identity === undefined || view.threads === undefined) return undefined;
  return {
    environmentId: view.identity.environmentId,
    threads: view.threads.list.map((digest) => {
      const completedAt = Date.parse(digest.completedAt ?? "");
      return {
        id: digest.id,
        title: digest.title,
        status: digest.kind,
        attention: ATTENTION.has(digest.kind) ? `${digest.turnId ?? ""}:${digest.kind}` : null,
        completedAt:
          SETTLED.has(digest.kind) &&
          digest.turnState === "completed" &&
          Number.isFinite(completedAt)
            ? completedAt
            : null,
      };
    }),
  };
}

/**
 * A Mate off its attention: each chat waiting on its person, and each finished turn of a resting
 * chat; titled as `titleOf` names the chat.
 */
export function attentionWatch(
  attention: MateAttention,
  titleOf: (threadId: ThreadId) => string,
): WatchedMate {
  const threads = new Map<ThreadId, WatchedThread>();
  const thread = (id: ThreadId): WatchedThread =>
    threads.get(id) ?? {
      id,
      title: titleOf(id),
      status: "idle",
      attention: null,
      completedAt: null,
    };
  for (const result of attention.results) {
    const held = thread(result.threadId);
    const completedAt = Date.parse(result.completedAt);
    if (!Number.isFinite(completedAt)) continue;
    threads.set(result.threadId, {
      ...held,
      completedAt: Math.max(held.completedAt ?? completedAt, completedAt),
    });
  }
  for (const question of attention.questions) {
    if (!ATTENTION.has(question.kind)) continue;
    threads.set(question.threadId, {
      ...thread(question.threadId),
      status: question.kind,
      attention: `${question.turnId ?? ""}:${question.kind}`,
    });
  }
  return { environmentId: attention.source.environmentId, threads: [...threads.values()] };
}

/**
 * The look after `previous` at `mates`, and what rings for it. Nothing is known while `mates` is
 * none. A Mate's first look is its baseline: nothing in it rings, as nothing in a snapshot does; a
 * Mate left out of a look (its word no longer of now) starts from a baseline again. After it, a
 * thread rings when it comes to wait on the person — once per turn and kind — or when it settles
 * with a turn completed after the last one it rang for. A chat first seen after the baseline
 * counts from nothing.
 */
export function watchMates(
  previous: MatesBaseline | null,
  mates: ReadonlyMap<string, WatchedMate> | null,
  nowMs: number,
): { readonly next: MatesBaseline | null; readonly rings: ReadonlyArray<ThreadRing> } {
  if (mates === null) return { next: null, rings: [] };
  const next = new Map<string, { since: number; threads: Map<ThreadId, ThreadMark> }>();
  const rings: Array<ThreadRing> = [];
  for (const [projectId, view] of mates) {
    const held = previous?.get(projectId);
    const threads = new Map<ThreadId, ThreadMark>();
    const since = held?.since ?? nowMs;
    for (const watched of view.threads) {
      // A chat first seen after the Mate's baseline counts from nothing: from no attention, and
      // from no completion after the baseline — a resting chat back in the list brings one from
      // before it.
      const prior = held?.threads.get(watched.id) ?? {
        attention: null,
        completion: held === undefined ? null : since,
      };
      const completion = watched.completedAt ?? prior.completion;
      const { attention } = watched;
      threads.set(watched.id, { attention, completion });
      if (held === undefined) continue;
      const kind =
        attention !== null && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (kind === null) continue;
      rings.push({
        environmentId: view.environmentId,
        threadId: watched.id,
        title: watched.title,
        kind,
        status: watched.status,
      });
    }
    next.set(projectId, { since, threads });
  }
  return { next, rings };
}

/** The environments of the Mates watched, as far as each says which it is. */
export function observedEnvironments(
  mates: ReadonlyMap<string, MateLiveView> | null,
  attention: ReadonlyArray<MateAttention>,
): ReadonlySet<EnvironmentId> {
  const observed = new Set<EnvironmentId>(attention.map(({ source }) => source.environmentId));
  for (const view of mates?.values() ?? []) {
    if (view.identity !== undefined) observed.add(view.identity.environmentId);
  }
  return observed;
}
