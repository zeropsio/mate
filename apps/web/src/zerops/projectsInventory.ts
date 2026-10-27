/** Inventory presentation decorates the shared grouping with the current Mate connection rows. */
import { canonicalInventoryGroups } from "@t3tools/client-runtime/data";
import {
  rankZeropsCandidateForListing,
  type ZeropsPlacedBirth,
  type CanonicalGroupTreeView,
} from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import type { ProjectOrderOptions } from "./projectOrderPreference";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { useProjection } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { useZeropsData } from "./zeropsDataContext";

const EMPTY = Atom.make({ groups: [], ungrouped: [], tools: [], empty: true });
export function useProjectsInventory(
  candidates: ReadonlyArray<ZeropsCandidatePresentation>,
  order: ProjectOrderOptions,
  births: ReadonlyArray<ZeropsPlacedBirth>,
): CanonicalGroupTreeView<ZeropsCandidatePresentation> {
  const { activeOrganization } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const tree = useProjection(
    canonicalInventoryGroups,
    activeOrganization === null
      ? null
      : {
          organization: organizationRef(activeOrganization.id),
          viewer: activeOrganization,
          projectIds: candidates.map(({ project }) => project.id),
          ...order,
          births,
        },
    EMPTY,
  );
  return useMemo(() => {
    const byId = new Map(candidates.map((candidate) => [candidate.project.id, candidate]));
    return {
      ...tree,
      groups: tree.groups.map(({ group, environments }) => ({
        group,
        environments: environments.map((entry) => ({
          ...entry,
          item: entry.project === undefined ? undefined : byId.get(entry.project.id),
        })),
      })),
      ungrouped: tree.ungrouped
        .flatMap(({ project }) => {
          const candidate = byId.get(project.id);
          return candidate === undefined ? [] : [candidate];
        })
        .sort((a, b) => rankZeropsCandidateForListing(a) - rankZeropsCandidateForListing(b)),
      tools: tree.tools.flatMap(({ kind, item }) => {
        const candidate = byId.get(item.project.id);
        return candidate === undefined ? [] : [{ kind, item: candidate }];
      }),
    };
  }, [tree, candidates]);
}
