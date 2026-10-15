import { useMemo } from "react";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import { useEnvironment } from "../state/environments";
import { orchestrationEnvironment } from "../state/orchestration";
import { useEnvironmentQuery } from "../state/query";
import type { Thread, TurnDiffSummary } from "../types";
import {
  runChangesRead,
  runChangesSeen,
  runChangesSupport,
  turnDiffSummariesOf,
} from "./turnDiffSummaries.logic";

export function useTurnDiffSummaries(activeThread: Thread | null | undefined) {
  // A Mate's runs that changed its workspace, as its server recorded their captures: read again
  // whenever a run starts or ends.
  // A Mate's server from before run changes would not know the read: it is never sent there.
  const capabilities = useEnvironment(activeThread?.environmentId ?? null)?.serverConfig
    ?.environment.capabilities;
  const supported = runChangesSupport(capabilities);
  const runChanges = useEnvironmentQuery(
    activeThread && supported === "supported"
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
    // Until the runs are read, or where they could not be or the Mate cannot yet, no turn list
    // says nothing changed.
    runChangesRead: runChangesRead({
      support: supported,
      failed: runChanges.error !== null,
      read: runs !== null,
    }),
  };
}
