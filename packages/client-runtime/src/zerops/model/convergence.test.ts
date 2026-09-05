/**
 * The convergence matrix: `deriveZeropsThreadModel` must be byte-identical
 * across every delivered row set that agrees on the `tool.started` /
 * `tool.completed` rows of every call (§2.5). Run over the five real
 * threads.
 */
import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  ZEROPS_SHOWCASE_THREADS,
  type ZeropsShowcaseThread,
} from "../operations/__fixtures__/index.ts";
import { deriveZeropsThreadModel, type ZeropsThreadModel } from "./deriveThreadModel.ts";

/** A deterministic seeded shuffle — same permutation every run, for reproducibility. */
function seededShuffle<T>(items: ReadonlyArray<T>, seed: number): T[] {
  const array = [...items];
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  for (let i = array.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/**
 * `rowIds` (and the model's `zeropsActivityIds`) name exactly the raw rows a
 * route happened to deliver — by construction they vary whenever a
 * permutation adds or drops rows, so they are excluded here. What must not
 * vary is every DERIVED fact: identity, order, status, input, resultText,
 * and everything the fold produces from them.
 */
function withoutRowIds(call: ZeropsThreadModel["calls"][number]) {
  const { rowIds: _rowIds, ...rest } = call;
  return rest;
}

function normalize(model: ZeropsThreadModel) {
  return {
    calls: model.calls.map(withoutRowIds),
    entries: model.entries.map((entry) =>
      entry.kind === "generic-call" ? { ...entry, call: withoutRowIds(entry.call) } : entry,
    ),
    session: model.session,
    running: model.running,
  };
}

function derive(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  return normalize(deriveZeropsThreadModel({ activities, runningTurnId: null }));
}

/**
 * The stored fixtures are the STORED form: a `tool.completed` row never
 * carries `data.zerops` (verified.md). On the wire the server re-projects it
 * from the raw `data.result` on every read (F8), so a snapshot compaction
 * that drops a call's `tool.updated` rows never actually loses the
 * enrichment there. This models that re-projection once, up front, so every
 * permutation below starts from the DELIVERED shape the real compaction
 * operates on.
 */
function toDeliveredForm(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const enrichmentByToolCallId = new Map<string, Record<string, unknown>>();
  for (const a of activities) {
    const payload = a.payload as Record<string, unknown> | undefined;
    const toolCallId = payload?.toolCallId;
    const data = payload?.data as Record<string, unknown> | undefined;
    const zerops = data?.zerops as Record<string, unknown> | undefined;
    if (typeof toolCallId === "string" && typeof zerops?.resultText === "string") {
      enrichmentByToolCallId.set(toolCallId, zerops);
    }
  }
  return activities.map((a) => {
    if (a.kind !== "tool.completed") {
      return a;
    }
    const payload = a.payload as Record<string, unknown>;
    const toolCallId = payload.toolCallId as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;
    const zerops = data?.zerops as Record<string, unknown> | undefined;
    if (typeof zerops?.resultText === "string" || toolCallId === undefined) {
      return a;
    }
    const enrichment = enrichmentByToolCallId.get(toolCallId);
    if (enrichment === undefined) {
      return a;
    }
    return {
      ...a,
      payload: { ...payload, data: { ...data, zerops: enrichment } },
    } as OrchestrationThreadActivity;
  });
}

const isToolUpdated = (a: OrchestrationThreadActivity): boolean => a.kind === "tool.updated";
const isToolCompleted = (a: OrchestrationThreadActivity): boolean => a.kind === "tool.completed";
const isToolStarted = (a: OrchestrationThreadActivity): boolean => a.kind === "tool.started";

function toolCallIdOf(a: OrchestrationThreadActivity): string | undefined {
  const payload = a.payload as Record<string, unknown> | undefined;
  const id = payload?.toolCallId;
  return typeof id === "string" ? id : undefined;
}

/** Every `tool.updated` removed whose call also has a `tool.completed` — the cold-snapshot case. */
function withSupersededUpdatesRemoved(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const completedToolCallIds = new Set(
    activities
      .filter(isToolCompleted)
      .map(toolCallIdOf)
      .filter((id): id is string => id !== undefined),
  );
  return activities.filter((a) => {
    if (!isToolUpdated(a)) {
      return true;
    }
    const id = toolCallIdOf(a);
    return id === undefined || !completedToolCallIds.has(id);
  });
}

/**
 * Every `tool.updated` duplicated — the replay case. A re-delivered row is
 * the SAME row (same id): activity ids are primary keys, so this duplicates
 * the row verbatim rather than minting a new id.
 */
function withUpdatesDuplicated(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  return activities.flatMap((a) => (isToolUpdated(a) ? [a, a] : [a]));
}

/** Every `tool.updated` moved after its call's `tool.completed`, order preserved otherwise. */
function withUpdatesMovedAfterCompletion(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const updates: OrchestrationThreadActivity[] = [];
  const rest: OrchestrationThreadActivity[] = [];
  for (const a of activities) {
    (isToolUpdated(a) ? updates : rest).push(a);
  }
  return [...rest, ...updates];
}

function withStartedRemoved(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  return activities.filter((a) => !isToolStarted(a));
}

describe.each(ZEROPS_SHOWCASE_THREADS.map((thread) => [thread.name, thread] as const))(
  "deriveZeropsThreadModel convergence — %s",
  (_name, thread: ZeropsShowcaseThread) => {
    const activities = toDeliveredForm(thread.activities);
    const baseline = derive(activities);

    it("is unchanged under a shuffle of the row order", () => {
      const shuffled = seededShuffle(activities, 42);
      expect(derive(shuffled)).toEqual(baseline);
    });

    it("is unchanged when every superseded tool.updated is dropped (cold snapshot)", () => {
      const snapshot = withSupersededUpdatesRemoved(activities);
      expect(derive(snapshot)).toEqual(baseline);
    });

    it("is unchanged when every tool.updated is duplicated (replay)", () => {
      const replayed = withUpdatesDuplicated(activities);
      expect(derive(replayed)).toEqual(baseline);
    });

    it("is unchanged when every tool.updated is moved after its tool.completed", () => {
      const reordered = withUpdatesMovedAfterCompletion(activities);
      expect(derive(reordered)).toEqual(baseline);
    });

    it("is unchanged except startedAt/anchorActivityId when every tool.started is removed", () => {
      const withoutStarted = withStartedRemoved(activities);
      const result = derive(withoutStarted);

      expect(result.calls.map((c) => c.id)).toEqual(baseline.calls.map((c) => c.id));
      expect(result.calls.map((c) => c.status)).toEqual(baseline.calls.map((c) => c.status));
      expect(result.calls.map((c) => c.resultText)).toEqual(
        baseline.calls.map((c) => c.resultText),
      );
      expect(result.session).toEqual(baseline.session);

      // Only the anchor moves (to the earliest surviving row); nothing else does.
      for (let i = 0; i < result.calls.length; i++) {
        const before = baseline.calls[i]!;
        const after = result.calls[i]!;
        if (before.anchorActivityId !== after.anchorActivityId) {
          expect(after.startedAt >= before.startedAt).toBe(true);
        }
      }
    });
  },
);
