/**
 * Whether each listed Mate's press in another browser is still at it (`pressElsewhere`), as its
 * organization's HQ holds it: a hold its press renews, and — once Zerops answered its container
 * import — that import's own process while its project still lists no container. After the press
 * disappears, HQ's birth or Mate record keeps that exact identity demanded. HQ says how long each hold runs on from its read (`heldForMs`); it is
 * measured from when this browser first heard that hold, never against HQ's clock, and drawn again
 * the moment the soonest runs out: a hold is the press's own lease, never a project's age.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  creationImports,
  projectCreations,
  type HqPressValue,
} from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  nextPressExpiry,
  pressElsewhere,
  type HqPresses,
  type PressElsewhere,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Each press HQ holds, its hold measured from when this browser first heard it (`heard`, by
 * project and hold): a renewed hold is a new one.
 */
export function pressHolds(
  presses: Readonly<Record<string, HqPressValue>>,
  heard: Map<string, number>,
  nowMs: number,
): HqPresses {
  return Object.fromEntries(
    Object.entries(presses).map(([projectId, press]) => {
      const hold = `${projectId}:${press.until}`;
      const at = heard.get(hold) ?? nowMs;
      heard.set(hold, at);
      return [
        projectId,
        {
          kind: press.kind,
          ...(press.appId === undefined ? {} : { appId: press.appId }),
          ...(press.importProcessId === undefined
            ? {}
            : { importProcessId: press.importProcessId }),
          expiresAtMs: at + press.heldForMs,
        },
      ];
    }),
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
  const heard = useRef(new Map<string, number>());
  // Unknown until HQ said what presses it holds.
  const presses = useMemo(
    () =>
      navigation.read === "unread"
        ? null
        : pressHolds(navigation.presses, heard.current, Date.now()),
    [navigation.presses, navigation.read],
  );
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
      const importProcessId = presses?.[projectId]?.importProcessId;
      const importStatus =
        importProcessId === undefined
          ? presses?.[projectId] === undefined
            ? recoveredResults[projectId]?.status
            : undefined
          : processes.get(projectId)?.find((process) => process.id === importProcessId)?.status;
      return pressElsewhere({
        presses,
        projectId,
        nowMs: Math.max(nowMs, Date.now()),
        importStatus,
      });
    },
    [presses, processes, recoveredResults, nowMs],
  );
}
