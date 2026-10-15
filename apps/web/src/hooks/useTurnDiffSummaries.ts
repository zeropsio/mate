import { useMemo } from "react";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import { orchestrationEnvironment } from "../state/orchestration";
import { useEnvironmentQuery } from "../state/query";
import type { Thread, TurnDiffSummary } from "../types";
import { runChangesSeen, turnDiffSummariesOf } from "./turnDiffSummaries.logic";

export function useTurnDiffSummaries(activeThread: Thread | null | undefined) {
  // A Mate's runs that changed its workspace, as its server recorded their captures: read again
  // whenever a run starts or ends.
  const runChanges = useEnvironmentQuery(
    activeThread
      ? orchestrationEnvironment.runChanges({
          environmentId: activeThread.environmentId,
          input: { threadId: activeThread.id, seen: runChangesSeen(activeThread.latestTurn) },
        })
      : null,
  );
  const runs = runChanges.data?.turns ?? null;
  const turnDiffSummaries = useMemo<ReadonlyArray<TurnDiffSummary>>(
    () => (activeThread ? turnDiffSummariesOf(activeThread.checkpoints, runs) : []),
    [activeThread, runs],
  );

  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return {
    turnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    // Until the runs are read, or where they could not be, no turn list says nothing changed.
    runChangesRead:
      runChanges.error !== null
        ? ("failed" as const)
        : runs === null
          ? ("reading" as const)
          : ("read" as const),
  };
}
