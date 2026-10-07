/** Inventory presentation decorates the shared grouping with the current Mate connection rows. */
import { inventoryGroups } from "@t3tools/client-runtime/data";
import {
  rankZeropsCandidateForListing,
  type ZeropsPlacedBirth,
  type ZeropsGroupTreeView,
} from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/unstable/reactivity";
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
): ZeropsGroupTreeView<ZeropsCandidatePresentation> {
  const { activeOrganization } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const tree = useProjection(
    inventoryGroups,
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
        environments: environments.flatMap(({ item, role }) => {
          const candidate = byId.get(item.project.id);
          return candidate === undefined ? [] : [{ item: candidate, role }];
        }),
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
