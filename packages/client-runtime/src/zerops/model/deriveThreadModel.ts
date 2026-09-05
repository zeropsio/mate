/**
 * `deriveZeropsThreadModel` — the one function. Pure, clockless, memoisable
 * on `(activities, lifecycle, runningTurnId)` reference identity. Web and
 * mobile both call this instead of hand-rolling their own activity → card
 * derivation. See
 * `mate-session-model-2026-09-05-designs/C-client-domain.md` §1.2.
 */
import type { OrchestrationThreadActivity, ZeropsLifecycle } from "@t3tools/contracts";

import { collectZeropsCalls } from "./calls.ts";
import { compareAnchors } from "./order.ts";
import { reduceZeropsOperations } from "./operations.ts";
import { partitionZeropsActivities } from "./partition.ts";
import { composeSession } from "./session.ts";
import type {
  ZeropsCall,
  ZeropsOperation,
  ZeropsSessionView,
  ZeropsTimelineEntry,
} from "./types.ts";

export interface ZeropsThreadModelInput {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  /** The lifecycle feed's latest snapshot; `recentTools` is ignored. */
  readonly lifecycle?: ZeropsLifecycle | undefined;
  /** The thread's running turn, or null when idle — the only "clock" the model has. */
  readonly runningTurnId?: string | null | undefined;
}

export interface ZeropsThreadModel {
  /** One per call, in `(startedAt, id)` order — the ledger. */
  readonly calls: ReadonlyArray<ZeropsCall>;
  /** What the timeline places: cards and generic Zerops rows, one per key. */
  readonly entries: ReadonlyArray<ZeropsTimelineEntry>;
  /** Every activity id that belongs to a Zerops call — the transcript never sees these rows. */
  readonly zeropsActivityIds: ReadonlySet<string>;
  readonly session: ZeropsSessionView;
  /** The running operation, if any (strip / map "running"). */
  readonly running: ZeropsOperation | undefined;
}

export function deriveZeropsThreadModel(input: ZeropsThreadModelInput): ZeropsThreadModel {
  const runningTurnId = input.runningTurnId ?? null;
  const { zeropsActivityIds } = partitionZeropsActivities(input.activities);
  const calls = collectZeropsCalls(input.activities, runningTurnId);
  const { operations, genericCalls } = reduceZeropsOperations(calls);

  const entries: ZeropsTimelineEntry[] = [
    ...operations.map((operation): ZeropsTimelineEntry => ({
      kind: "operation",
      key: operation.key,
      anchorAt: operation.anchorAt,
      anchorActivityId: operation.anchorActivityId,
      operation,
    })),
    ...genericCalls.map((call): ZeropsTimelineEntry => ({
      kind: "generic-call",
      key: `op:${call.id}`,
      anchorAt: call.startedAt,
      anchorActivityId: call.anchorActivityId,
      call,
    })),
  ].sort(compareAnchors);

  const session = composeSession(input.lifecycle?.envelope, operations);

  let running: ZeropsOperation | undefined;
  for (const operation of operations) {
    if (operation.phase === "running") {
      running = operation;
    }
  }

  return { calls, entries, zeropsActivityIds, session, running };
}
