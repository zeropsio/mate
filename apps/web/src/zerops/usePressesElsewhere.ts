/**
 * Whether each listed Mate's press in another browser is still at it (`pressElsewhere`), as its
 * organization's HQ holds it: a hold its press renews, and — once Zerops answered its container
 * import — that import's own process, read from its project's processes while its project still
 * lists no container. Drawn again the moment the soonest hold runs out: a hold is the press's own
 * lease, never a project's age.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  nextPressExpiry,
  pressElsewhere,
  type HqPresses,
  type PressElsewhere,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useMemo, useState } from "react";

import { hqStructureAtom } from "../state/zerops";
import { useProjectsProcesses } from "./activity/useProjectsProcesses";

/** The projects listing no container whose press named its import: theirs are followed. */
export function importsToFollow(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "project" | "missingContainer">>,
  presses: HqPresses | null,
): ReadonlyArray<string> {
  return candidates.flatMap((candidate) =>
    candidate.missingContainer === true &&
    presses?.get(candidate.project.id)?.importProcessId !== undefined
      ? [candidate.project.id]
      : [],
  );
}

export function usePressesElsewhere(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (projectId: string) => PressElsewhere {
  const presses = useAtomValue(hqStructureAtom)?.presses ?? null;
  const importing = useMemo(() => importsToFollow(candidates, presses), [candidates, presses]);
  const processes = useProjectsProcesses(importing);
  // A hold that runs out says so the moment it does: drawn again then, on its own clock.
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const at = nextPressExpiry(presses, nowMs);
    if (at === null) return;
    const timer = setTimeout(() => setNowMs(Date.now()), at - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [presses, nowMs]);
  return useCallback(
    (projectId: string) => {
      const importProcessId = presses?.get(projectId)?.importProcessId;
      const importStatus =
        importProcessId === undefined
          ? undefined
          : processes.get(projectId)?.find((process) => process.id === importProcessId)?.status;
      return pressElsewhere({
        presses,
        projectId,
        nowMs: Math.max(nowMs, Date.now()),
        importStatus,
      });
    },
    [presses, processes, nowMs],
  );
}
