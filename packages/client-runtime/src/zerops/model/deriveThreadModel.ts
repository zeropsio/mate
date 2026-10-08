import type { RestartReading, RestartProcess } from "../../data/projections/restart.ts";
/**
 * `deriveZeropsThreadModel` — the one function. Pure, memoisable on
 * `(activities, lifecycle, runningTurnId, builds)`; what the platform says of a
 * build a deploy named is an input, never a clock. Web and mobile both call
 * this instead of hand-rolling their own activity → card derivation. See
 * `mate-session-model-2026-09-05-designs/C-client-domain.md` §1.2.
 */
import type { OrchestrationThreadActivity, ZeropsLifecycle } from "@t3tools/contracts";

import type { DeployBuildRead } from "../activity/deployBuild.ts";
import type { Known } from "../knowledge/index.ts";

import { collectZeropsCalls } from "./calls.ts";
import { compareAnchors } from "./order.ts";
import { reduceZeropsOperations } from "./operations.ts";
import { composeSession } from "./session.ts";
import type {
  ZeropsCall,
  ZeropsOperation,
  ZeropsSessionView,
  ZeropsTimelineEntry,
} from "./types.ts";

export interface ZeropsThreadModelInput {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  /**
   * The lifecycle feed; `recentTools` is ignored. Only a known snapshot, stale or not, carries an
   * envelope: until then the session has no phase, and the strip says nothing rather than a
   * phase nobody read.
   */
  readonly lifecycle?: Known<ZeropsLifecycle> | undefined;
  /** The thread's running turn, or null when idle. */
  readonly runningTurnId?: string | null | undefined;
  /**
   * Where the build a deploy result named by its appVersion stands on the platform — a
   * BUILD_TRIGGERED deploy's phase is its answer. Absent, no build can be read: such a deploy is
   * uncertain.
   */
  readonly builds?: ((appVersionId: string) => DeployBuildRead) | undefined;
  readonly restarts?: ((process: RestartProcess) => RestartReading) | undefined;
}

const UNOBSERVABLE = (): DeployBuildRead => "unobservable";

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
  const calls = collectZeropsCalls(input.activities, runningTurnId);
  const zeropsActivityIds = new Set<string>(calls.flatMap((call) => [...call.rowIds]));
  const lifecycle = input.lifecycle;
  const envelope = lifecycle?.state === "known" ? lifecycle.value.envelope : undefined;
  const { operations, genericCalls } = reduceZeropsOperations(calls, {
    projectId: envelope?.project.id,
    builds: input.builds ?? UNOBSERVABLE,
    ...(input.restarts === undefined ? {} : { restarts: input.restarts }),
  });

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

  const session = composeSession(envelope, operations);

  let running: ZeropsOperation | undefined;
  for (const operation of operations) {
    if (operation.phase === "running") {
      running = operation;
    }
  }

  return { calls, entries, zeropsActivityIds, session, running };
}
