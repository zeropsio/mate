/**
 * A project's Mates as a review draws them: by name and in their colour — the faces on a
 * change's line and on each change a release carries. Read off the candidate list, the one
 * source for names, tags and colours, so a review never disagrees with the left menu about who
 * a Mate is. Whose Mate a fix may go to is `fixMates.ts`'s to say, once for every surface.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  hasMate,
  readZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { MateTintId } from "@t3tools/shared/brand";
import { useMemo } from "react";

import { useZeropsCandidates } from "./useZeropsCandidates";

export interface ZeropsReviewMate {
  readonly mateProjectId: string;
  readonly name: string;
  readonly tint: MateTintId;
}

export function useZeropsReviewMates(
  groupId: string | undefined,
): ReadonlyMap<string, ZeropsReviewMate> {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    const mates = new Map<string, ZeropsReviewMate>();
    if (groupId === undefined) return mates;
    const rows = heldCandidates(listing).rows;
    const tints = assignCandidateMateTints(rows);
    for (const row of rows) {
      const tags = readZeropsGroupTags(row.project.tagList);
      if (tags.groupId !== groupId || !hasMate(row) || mates.has(row.project.id)) continue;
      mates.set(row.project.id, {
        mateProjectId: row.project.id,
        name: botDisplayName({ bot: tags.bot, projectName: row.project.name }),
        tint: tints.get(row.project.id) ?? "slate",
      });
    }
    return mates;
  }, [groupId, listing]);
}
