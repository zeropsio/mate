/**
 * Whether each listed Mate's press in another browser is still at it (`pressElsewhere`), as its
 * organization's HQ holds it: a hold its press renews, and — once Zerops answered its container
 * import — that import's own process, read from its project's processes while its project still
 * lists no container. A hold is the press's own lease at HQ, never a project's age: HQ says when
 * it ends.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  pressElsewhere,
  type HqPresses,
  type PressElsewhere,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useMemo } from "react";

import { hqNavigationAtom } from "../state/zerops";
import { useProjectsProcesses } from "./activity/useProjectsProcesses";

/** The projects listing no container whose press named its import: theirs are followed. */
export function importsToFollow(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "project" | "missingContainer">>,
  presses: HqPresses | null,
): ReadonlyArray<string> {
  return candidates.flatMap((candidate) =>
    candidate.missingContainer === true &&
    presses?.[candidate.project.id]?.importProcessId !== undefined
      ? [candidate.project.id]
      : [],
  );
}

export function usePressesElsewhere(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (projectId: string) => PressElsewhere {
  const navigation = useAtomValue(hqNavigationAtom);
  // Unknown until HQ said what presses it holds.
  const presses = navigation.read === "unread" ? null : navigation.presses;
  const importing = useMemo(() => importsToFollow(candidates, presses), [candidates, presses]);
  const processes = useProjectsProcesses(importing);
  return useCallback(
    (projectId: string) => {
      const importProcessId = presses?.[projectId]?.importProcessId;
      const importStatus =
        importProcessId === undefined
          ? undefined
          : processes.get(projectId)?.find((process) => process.id === importProcessId)?.status;
      return pressElsewhere({ presses, projectId, importStatus });
    },
    [presses, processes],
  );
}
