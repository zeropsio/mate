/** Drawn rows hold only the project detail needed to decide the viewer’s access. */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useAtomValue } from "@effect/atom-react";
import { accountReadsAtom, ownRowWanted, shownProjectsAtom } from "@t3tools/client-runtime/data";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useZeropsSessionOptional } from "./sessionContext";

/** The projects HQ places a Mate in, once each. */
export function drawnMateProjects(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "project">>,
): ReadonlyArray<string> {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.project.hq !== undefined && isMateKind(candidate.project.hq.kind)
          ? [candidate.project.id]
          : [],
      ),
    ),
  ];
}

export function useVisibleProjectAccess(projectIds: ReadonlyArray<string>): void {
  // Each row held once while its Mate is drawn and it decides the viewer's access: one drawn or
  // let go moves no other's hold.
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  const viewerRole = useZeropsSessionOptional()?.activeOrganization?.roleCode;
  const roster = useAtomValue(shownProjectsAtom).projects;
  const wanted = useMemo(
    () =>
      [...new Set(projectIds)].filter((projectId) =>
        ownRowWanted(viewerRole, roster.find(({ id }) => id === projectId) ?? null),
      ),
    [projectIds, roster, viewerRole],
  );
  const rows = useRef(new Map<string, () => void>());
  const heldBy = useRef(demandDetail);
  useEffect(() => {
    const held = rows.current;
    // Another account's reads hold nothing of the one before.
    if (heldBy.current !== demandDetail) {
      for (const release of held.values()) release();
      held.clear();
      heldBy.current = demandDetail;
    }
    const drawn = new Set<string>(demandDetail === undefined ? [] : wanted);
    for (const [ownerId, release] of held) {
      if (drawn.has(ownerId)) continue;
      release();
      held.delete(ownerId);
    }
    for (const ownerId of drawn) {
      if (!held.has(ownerId))
        held.set(ownerId, demandDetail!({ family: "project", listing: "project", ownerId }));
    }
  }, [demandDetail, wanted]);
  useEffect(
    () => () => {
      for (const release of rows.current.values()) release();
      rows.current.clear();
    },
    [],
  );
}

/**
 * For a surface whose Mates are drawn row by row, each mounted on its own: `drawn(projectId)`
 * says a row of that Mate is drawn, until the function it returns is called. Each Mate's project
 * access detail is held while any row of it is drawn. The same function for a Mate on every render, so a row's
 * effect keyed by it runs once.
 */
export function useDrawnProjectAccess(): (projectId: string) => () => () => void {
  const [rows, setRows] = useState<ReadonlyMap<string, number>>(() => new Map());
  const projectIds = useMemo(() => [...rows.keys()], [rows]);
  useVisibleProjectAccess(projectIds);
  const byProject = useRef(new Map<string, () => () => void>());
  return useCallback((projectId: string) => {
    const known = byProject.current.get(projectId);
    if (known !== undefined) return known;
    const drawn = () => {
      setRows((held) => new Map(held).set(projectId, (held.get(projectId) ?? 0) + 1));
      return () => {
        setRows((held) => {
          const next = new Map(held);
          const left = (held.get(projectId) ?? 1) - 1;
          if (left > 0) next.set(projectId, left);
          else next.delete(projectId);
          return next;
        });
      };
    };
    byProject.current.set(projectId, drawn);
    return drawn;
  }, []);
}
