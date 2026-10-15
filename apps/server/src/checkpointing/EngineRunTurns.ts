/**
 * A Mate engine conversation's runs as the Diff page's turns: each finished capture of one of its
 * runs (`<conversation>/r/<n>`) is turn `n`, its history what that turn's diff reads
 * (`workspaceHistoryRange`). Captures of anything else in the journal (an older thread's turns)
 * are not the engine's and are left out. Pure.
 *
 * @module EngineRunTurns
 */
import {
  CheckpointRef,
  TurnId,
  type CheckpointCaptureSnapshot,
  type OrchestrationCheckpointSummary,
  type ThreadId,
} from "@t3tools/contracts";

import type { CaptureRun } from "./WorkspaceCaptureJournal.ts";

/** The run's ordinal where the id is one of this conversation's engine runs. */
const ordinalOf = (threadId: ThreadId, runId: string): number | undefined => {
  const prefix = `${threadId}/r/`;
  if (!runId.startsWith(prefix)) return undefined;
  const rest = runId.slice(prefix.length);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : undefined;
};

const capturedAt = (snapshot: CheckpointCaptureSnapshot): string | undefined =>
  snapshot.completedAt ?? snapshot.startedAt;

/** Every finished capture of the conversation's engine runs, by ordinal. */
export function engineRunTurns(
  threadId: ThreadId,
  runs: ReadonlyArray<CaptureRun>,
): ReadonlyArray<OrchestrationCheckpointSummary> {
  const turns: Array<OrchestrationCheckpointSummary> = [];
  for (const run of runs) {
    const ordinal = ordinalOf(threadId, run.runId);
    if (ordinal === undefined || run.turnId === null || run.phase !== "finalized") continue;
    const { roots } = run.history;
    // When it ended is when its end was captured: the latest of its sources'.
    const completedAt = roots
      .flatMap((root) => [capturedAt(root.after), capturedAt(root.before)])
      .filter((at): at is string => at !== undefined)
      .toSorted()
      .at(-1);
    const end = roots.findLast((root) => root.after.status === "captured")?.after;
    if (completedAt === undefined) continue;
    turns.push({
      turnId: TurnId.make(run.turnId),
      checkpointTurnCount: ordinal,
      checkpointRef:
        end?.status === "captured"
          ? end.ref
          : CheckpointRef.make(`refs/t3/checkpoints/${threadId}/runs/${ordinal}/after`),
      status: end === undefined ? "missing" : "ready",
      files: roots.flatMap((root) => root.files ?? []),
      history: run.history,
      assistantMessageId: null,
      completedAt,
    });
  }
  return turns.toSorted((a, b) => a.checkpointTurnCount - b.checkpointTurnCount);
}

/**
 * Whether a run changed the workspace, so the Diff page offers it as a turn: a file it changed,
 * or a source whose changes were too many to list.
 */
export function engineRunChangedSomething(turn: OrchestrationCheckpointSummary): boolean {
  if (turn.files.length > 0) return true;
  return (
    turn.history?.roots.some(
      (root) =>
        root.files === undefined &&
        root.before.status === "captured" &&
        root.after.status === "captured",
    ) ?? false
  );
}
