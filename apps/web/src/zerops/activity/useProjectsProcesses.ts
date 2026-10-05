/**
 * The processes of several projects at once — what runs, what ended this session and the newest
 * history — held while this is drawn and read from the account's store; a project the grant
 * withholds (DESIGN §4.2 G12) reads as not read. What a surface listing many Mates follows each
 * one's own process by, never a clock.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { useEffect, useMemo, useRef } from "react";

import { projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useAccountDataOptional } from "../ZeropsAccountData";
import { useProjectsActivityRead } from "./useProjectActivity";

/** Each project's processes by id; none for a project not read yet, or one the grant withholds. */
export function useProjectsProcesses(
  projectIds: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<ActivityProcess> | undefined> {
  const inventory = useZeropsInventory();
  const admitted = useMemo(
    () => projectIds.filter((id) => projectAuthority(inventory, id).kind !== "withheld"),
    [inventory, projectIds],
  );
  // Each project's history held while it is followed: one joining or leaving takes or lets go of
  // its own hold only, never the others'.
  const demandDetail = useAccountDataOptional()?.demandDetail;
  const holds = useRef<{
    readonly demandDetail: typeof demandDetail;
    readonly released: Map<string, () => void>;
  }>({ demandDetail: undefined, released: new Map() });
  const key = admitted.join(",");
  useEffect(() => {
    // Another account's observation: every hold moves to it.
    if (holds.current.demandDetail !== demandDetail) {
      for (const release of holds.current.released.values()) release();
      holds.current = { demandDetail, released: new Map() };
    }
    const { released } = holds.current;
    const following = new Set(key === "" ? [] : key.split(","));
    for (const [projectId, release] of released)
      if (!following.has(projectId)) {
        release();
        released.delete(projectId);
      }
    if (demandDetail === undefined) return;
    for (const ownerId of following)
      if (!released.has(ownerId))
        released.set(ownerId, demandDetail({ family: "process", listing: "history", ownerId }));
  }, [demandDetail, key]);
  useEffect(
    () => () => {
      for (const release of holds.current.released.values()) release();
      holds.current = { demandDetail: undefined, released: new Map() };
    },
    [],
  );
  const reads = useProjectsActivityRead(admitted);
  return useMemo(
    () => new Map(admitted.map((id) => [id, reads[id]?.processes] as const)),
    [admitted, reads],
  );
}
