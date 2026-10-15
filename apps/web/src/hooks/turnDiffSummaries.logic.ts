import type { ExecutionEnvironmentCapabilities, OrchestrationLatestTurn } from "@t3tools/contracts";

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

/**
 * Whether the Mate's server reads its runs' changes: one from before them reports no
 * `runChanges` and is never asked; one whose capabilities are not read yet is not asked yet.
 */
export function runChangesSupport(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "runChanges"> | undefined,
): "supported" | "needs-update" | "unknown" {
  if (capabilities === undefined) return "unknown";
  return capabilities.runChanges === true ? "supported" : "needs-update";
}

/** Where the Diff page's read of a Mate's run changes stands. */
export type RunChangesRead = "read" | "reading" | "failed" | "needs-update";

export function runChangesRead(input: {
  readonly support: ReturnType<typeof runChangesSupport>;
  readonly failed: boolean;
  readonly read: boolean;
}): RunChangesRead {
  if (input.support === "needs-update") return "needs-update";
  if (input.support === "unknown") return "reading";
  if (input.failed) return "failed";
  return input.read ? "read" : "reading";
}
