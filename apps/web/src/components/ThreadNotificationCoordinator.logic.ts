/**
 * What rings, over the Mates HQ says the person may observe (step A): a pure fold the coordinator
 * runs on every change of HQ's view.
 *
 * @module ThreadNotificationCoordinator.logic
 */
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateThreadKind } from "@t3tools/shared/mateLink";

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

/**
 * The look after `previous` at `mates`, and what rings for it. Nothing is known while `mates` is
 * none. A Mate's first look is its baseline: nothing in it rings, as nothing in a snapshot does.
 * After it, a thread rings when it comes to wait on the person — once per turn and kind (the
 * attention key `turnId:kind`) — or when it settles with a turn completed after the last one it
 * rang for. A chat first seen after the baseline counts from nothing.
 */
export function watchMates(
  previous: MatesBaseline | null,
  mates: HqMates | null,
  nowMs: number,
): { readonly next: MatesBaseline | null; readonly rings: ReadonlyArray<ThreadRing> } {
  if (mates === null) return { next: null, rings: [] };
  const next = new Map<string, { since: number; threads: Map<ThreadId, ThreadMark> }>();
  const rings: Array<ThreadRing> = [];
  for (const [projectId, view] of mates) {
    if (view.identity === undefined || view.threads === undefined) continue;
    const held = previous?.get(projectId);
    const threads = new Map<ThreadId, ThreadMark>();
    const since = held?.since ?? nowMs;
    for (const digest of view.threads.list) {
      const attention = ATTENTION.has(digest.kind) ? `${digest.turnId ?? ""}:${digest.kind}` : null;
      // A chat first seen after the Mate's baseline counts from nothing: from no attention, and
      // from no completion after the baseline — a resting chat back in the list of forty brings
      // one from before it.
      const prior = held?.threads.get(digest.id) ?? {
        attention: null,
        completion: held === undefined ? null : since,
      };
      const completedAt = Date.parse(digest.completedAt ?? "");
      const completion =
        SETTLED.has(digest.kind) && digest.turnState === "completed" && Number.isFinite(completedAt)
          ? completedAt
          : prior.completion;
      threads.set(digest.id, { attention, completion });
      if (held === undefined) continue;
      const kind =
        attention !== null && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (kind === null) continue;
      rings.push({
        environmentId: view.identity.environmentId,
        threadId: digest.id,
        title: digest.title,
        kind,
        status: digest.kind,
      });
    }
    next.set(projectId, { since, threads });
  }
  return { next, rings };
}

/** The environments of the Mates in HQ's view, as far as each says which it is. */
export function observedEnvironments(mates: HqMates | null): ReadonlySet<EnvironmentId> {
  const observed = new Set<EnvironmentId>();
  for (const view of mates?.values() ?? []) {
    if (view.identity !== undefined) observed.add(view.identity.environmentId);
  }
  return observed;
}
