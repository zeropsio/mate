/**
 * The project inventories of the Mates a page draws, held while it stands (R7: the drawn stop owns
 * its service demand). Access is verified and services read only for a project some surface
 * demands, so a page that lists Mates by HQ's placement demands each one's: without it, a Mate's
 * container stays unread — no service to restart, nothing up to add an environment beside. Its
 * project is read as a route's is, and nothing connects to it.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "./inventoryContext";
import { useZeropsData } from "./zeropsDataContext";

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

export function useMatesInventory(candidates: ReadonlyArray<Pick<ZeropsCandidate, "project">>) {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const projects = useMemo(
    () =>
      drawnMateProjects(candidates).flatMap((projectId) => {
        // A refused project is not asked again by drawing it; one still being verified is.
        const authority = projectAuthority(inventory, projectId);
        if (authority.kind === "withheld" && authority.reason === "access-denied") return [];
        const ref = findInventoryProjectRef(inventory, projectId);
        return ref === null ? [] : [ref];
      }),
    [candidates, inventory],
  );
  // The projects' ids say what is demanded: a new list of the same ones demands nothing new.
  const identity = projects
    .map(({ projectId }) => projectId)
    .sort()
    .join(",");
  useEffect(() => {
    if (projects.length === 0) return;
    const controller = new AbortController();
    for (const project of projects) {
      void Effect.runPromise(
        Effect.scoped(
          runtime
            .acquire({ kind: "project-inventory", project })
            .pipe(Effect.andThen(Effect.never)),
        ),
        { signal: controller.signal },
      ).catch(() => undefined);
    }
    return () => {
      controller.abort();
    };
  }, [runtime, identity]);
}
