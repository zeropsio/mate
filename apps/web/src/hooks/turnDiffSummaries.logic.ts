import type { OrchestrationLatestTurn } from "@t3tools/contracts";

import type { TurnDiffSummary } from "../types";

/**
 * The turns the Diff page offers: those the conversation's own record holds, and the runs its
 * Mate's server recorded changing the workspace (`orchestration.getRunChanges`) — a run's record
 * standing over an older one numbered the same. Oldest first.
 */
export function turnDiffSummariesOf(
  recorded: ReadonlyArray<TurnDiffSummary>,
  runs: ReadonlyArray<TurnDiffSummary> | null,
): ReadonlyArray<TurnDiffSummary> {
  if (runs === null || runs.length === 0) return recorded;
  const numbered = new Set(runs.map((run) => run.checkpointTurnCount));
  return [...recorded.filter((turn) => !numbered.has(turn.checkpointTurnCount)), ...runs].toSorted(
    (a, b) => a.checkpointTurnCount - b.checkpointTurnCount,
  );
}

/**
 * What the Diff page last saw of the conversation's runs: its latest run, and whether it ended.
 * A run that starts or ends is a new sight, and its changes are read again.
 */
export function runChangesSeen(latestTurn: OrchestrationLatestTurn | null): string {
  if (latestTurn === null) return "none";
  return `${latestTurn.turnId}:${latestTurn.completedAt ?? "running"}`;
}
