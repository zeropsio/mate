/**
 * Whether each listed Mate's press in another browser is still at it (`pressElsewhere`), as its
 * organization's HQ holds it: a hold that lives with its press's HQ stream, and — once Zerops
 * answered its container import — that import's own process while its project still lists no
 * container. After the press disappears, HQ's birth or Mate record keeps that exact identity
 * demanded. A hold ends when HQ says so in its presses scope: no reader times it out.
 */
import { useAtomValue } from "@effect/atom-react";
import { accountReadsAtom, creationImports, projectCreations } from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  pressElsewhere,
  type HqPresses,
  type PressElsewhere,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useMemo } from "react";
import { Atom } from "effect/reactivity";

import { hqNavigationAtom } from "../state/zerops";
import { useProjectsProcesses } from "./activity/useProjectsProcesses";

const NO_IMPORTS = Atom.make<Readonly<Record<string, string | null>>>({});
const NO_RESULTS = Atom.make<ReturnType<typeof projectCreations.derive>>({});

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
  const account = useAtomValue(accountReadsAtom);
  const imports = useAtomValue(
    account?.orgId == null ? NO_IMPORTS : account.data.project(creationImports, account.orgId),
  );
  // Unknown until HQ said what presses it holds.
  const presses = navigation.read === "unread" ? null : navigation.presses;
  const importing = useMemo(() => importsToFollow(candidates, presses), [candidates, presses]);
  const processes = useProjectsProcesses(importing);
  const recovered = candidates.flatMap((candidate) => {
    const id = imports[candidate.project.id];
    return candidate.missingContainer === true &&
      presses?.[candidate.project.id] === undefined &&
      id != null
      ? [{ projectId: candidate.project.id, processId: id }]
      : [];
  });
  const recoveredKey = recovered
    .map(({ processId }) => processId)
    .sort()
    .join(",");
  const demandDetail = account?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || recoveredKey === "") return;
    const releases = recoveredKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "process", listing: "process", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, recoveredKey]);
  const recoveredResults = useAtomValue(
    account?.orgId == null
      ? NO_RESULTS
      : account.data.project(projectCreations, {
          orgId: account.orgId,
          projectIds: recovered.map(({ projectId }) => projectId),
        }),
  );
  return useCallback(
    (projectId: string) => {
      const importProcessId = presses?.[projectId]?.importProcessId;
      const importStatus =
        importProcessId === undefined
          ? presses?.[projectId] === undefined
            ? recoveredResults[projectId]?.status
            : undefined
          : processes.get(projectId)?.find((process) => process.id === importProcessId)?.status;
      return pressElsewhere({ presses, projectId, importStatus });
    },
    [presses, processes, recoveredResults],
  );
}
