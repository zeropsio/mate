/**
 * The project inventories of the Mates a surface draws, held while it draws them. A Mate's
 * services are the organization's services listing's, read for every project at once; what the
 * held inventory still demands is the Mate's container's variables (its setup marker and Mate
 * flag), read only for the Mates drawn: the projects page's, a project page's own, the left
 * menu's rows as they are mounted.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import { useCallback, useMemo, useRef, useState } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "./inventoryContext";
import { useInterestLeases } from "./useInterestLeases";

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
