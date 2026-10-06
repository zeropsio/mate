/**
 * The project inventories of the Mates a surface draws, held while it draws them. A Mate's
 * services are the organization's services listing's, read for every project at once; what the
 * held inventory still demands is the Mate's container's variables (its setup marker and Mate
 * flag), read only for the Mates drawn: the projects page's, a project page's own, the left
 * menu's rows as they are mounted. A drawn Mate's project's own row is held as well where it
 * decides the viewer's access (`ownRowWanted`): a NO_ACCESS member's project whose listing names no
 * grant of theirs. Whose a Mate is comes from HQ's person facts.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useAtomValue } from "@effect/atom-react";
import { accountReadsAtom, ownRowWanted, shownProjectsAtom } from "@t3tools/client-runtime/data";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "./inventoryContext";
import { useInterestLeases } from "./useInterestLeases";
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

export function useMatesInventory(projectIds: ReadonlyArray<string>): void {
  const inventory = useZeropsInventory();
  const projects = useMemo(
    () =>
      [...new Set(projectIds)].flatMap((projectId) => {
        // A refused project is not asked again by drawing it; one still being verified is.
        const authority = projectAuthority(inventory, projectId);
        if (authority.kind === "withheld" && authority.reason === "access-denied") return [];
        const ref = findInventoryProjectRef(inventory, projectId);
        return ref === null ? [] : [ref];
      }),
    [projectIds, inventory],
  );
  useInterestLeases(
    useMemo(
      () => projects.map((project) => ({ kind: "project-inventory" as const, project })),
      [projects],
    ),
  );
  // Each row held once while its Mate is drawn and it decides the viewer's access: one drawn or
  // let go moves no other's hold.
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  const viewerRole = useZeropsSessionOptional()?.activeOrganization?.roleCode;
  const roster = useAtomValue(shownProjectsAtom).projects;
  const wanted = useMemo(
    () =>
      projects
        .map(({ projectId }) => projectId)
        .filter((projectId) =>
          ownRowWanted(viewerRole, roster.find(({ id }) => id === projectId) ?? null),
        ),
    [projects, roster, viewerRole],
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
 * is read while any row of it is drawn. The same function for a Mate on every render, so a row's
 * effect keyed by it runs once.
 */
export function useDrawnMates(): (projectId: string) => () => () => void {
  const [rows, setRows] = useState<ReadonlyMap<string, number>>(() => new Map());
  const projectIds = useMemo(() => [...rows.keys()], [rows]);
  useMatesInventory(projectIds);
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
