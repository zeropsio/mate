/**
 * Where each group was last drawn — a row or an "Only a Mate so far" tile —
 * so a group whose facts are not settled yet (its flow unread, a Mate
 * reconnecting) stays where it was (`groupPlacement`). Held in memory for the
 * account's lifetime in this tab: it survives leaving `/zerops` and coming
 * back, and is dropped the moment the account changes.
 */
import { useEffect } from "react";

import { onAccountLifetimeClose } from "~/zerops/accountLifetime";
import { groupPlacement, type FoldedGroupInput, type GroupPlacement } from "./projectsView.logic";

const placements = new Map<string, GroupPlacement>();

onAccountLifetimeClose(() => {
  placements.clear();
});

export function lastGroupPlacement(groupId: string): GroupPlacement | undefined {
  return placements.get(groupId);
}

export function rememberGroupPlacements(
  entries: Iterable<readonly [groupId: string, placement: GroupPlacement]>,
): void {
  for (const [groupId, placement] of entries) placements.set(groupId, placement);
}

/** Records where the flow (`ZeropsProjectsFlow`) drew each group, once it has drawn them. */
export function useRememberGroupPlacements(
  groups: ReadonlyArray<FoldedGroupInput & { readonly group: { readonly groupId: string } }>,
): void {
  useEffect(() => {
    rememberGroupPlacements(groups.map((entry) => [entry.group.groupId, groupPlacement(entry)]));
  }, [groups]);
}
