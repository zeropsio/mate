/**
 * A project's Mates as a review names them: by name, in their colour, and whether each is the
 * person's own — only their own are offered a problem to fix (S6), the one they used last first
 * (`fixMateChoice`). Read off the candidate list, the one source for names, tags and colours, so
 * a review never disagrees with the left menu about who a Mate is.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  assignCandidateMateTints,
  botDisplayName,
  hasMate,
  readZeropsGroupTags,
  resolvePrimaryConversation,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import type { FixMate } from "./fixRequest";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsMateOwners } from "./useZeropsMateOwners";

export interface ZeropsReviewMate extends FixMate {
  readonly name: string;
  readonly tint: MateTintId;
  /** Its container's environment, while it is connected. */
  readonly environmentId: EnvironmentId | undefined;
}

export function useZeropsReviewMates(
  groupId: string | undefined,
): ReadonlyMap<string, ZeropsReviewMate> {
  const { listing } = useZeropsCandidates();
  const rows = useMemo(() => heldCandidates(listing).rows, [listing]);
  const ownerOf = useZeropsMateOwners({ candidates: rows, enabled: groupId !== undefined });
  const shells = useThreadShells();
  const visited = useUiStateStore((state) => state.threadLastVisitedAtById);
  return useMemo(() => {
    const mates = new Map<string, ZeropsReviewMate>();
    if (groupId === undefined) return mates;
    const tints = assignCandidateMateTints(rows);
    for (const row of rows) {
      const tags = readZeropsGroupTags(row.project.tagList);
      if (tags.groupId !== groupId || !hasMate(row) || mates.has(row.project.id)) continue;
      const environmentId = row.environmentId;
      const primary =
        environmentId === undefined
          ? undefined
          : resolvePrimaryConversation(
              shells.filter((shell) => shell.environmentId === environmentId),
            ).primary;
      mates.set(row.project.id, {
        mateProjectId: row.project.id,
        name: botDisplayName({ bot: tags.bot, projectName: row.project.name }),
        tint: tints.get(row.project.id) ?? "slate",
        mine: ownerOf(row)?.isViewer === true,
        lastVisitedAt:
          environmentId === undefined || primary === undefined
            ? undefined
            : visited[scopedThreadKey(scopeThreadRef(environmentId, primary.id))],
        environmentId,
      });
    }
    return mates;
  }, [groupId, ownerOf, rows, shells, visited]);
}
