/**
 * The landings one conversation places on its own timeline.
 *
 * A Mate's message is frozen when it is written, so what it said about a change
 * stops being true the moment somebody merges (the owner, 2026-09-20). The chip
 * inside the message says where the change stands now; this says when it moved,
 * in the place a person reads the work in order.
 *
 * Every group's landed changes are handed to `changeLandedEvents` together: it
 * keeps the ones belonging to this conversation's Mate, so no group has to be
 * looked up here. Outside a Zerops session there is no flow and no Mate, and it
 * takes nothing.
 */
import { changeLandedEvents, type ChangeLandedEvent } from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import { useZeropsProjectFlowOptional } from "./projectFlowContext";
import { useZeropsCandidates } from "./useZeropsCandidates";

const NONE: ReadonlyArray<ChangeLandedEvent> = [];

export function useZeropsChangeLandedEvents(
  environmentId: string | null | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  const flowValue = useZeropsProjectFlowOptional();
  const { candidates } = useZeropsCandidates();
  const flows = flowValue?.flows;
  return useMemo(() => {
    if (environmentId === null || environmentId === undefined || flows === undefined) return NONE;
    const mateProjectId = candidates.find(
      (candidate) => String(candidate.environmentId) === String(environmentId),
    )?.project.id;
    if (mateProjectId === undefined) return NONE;
    const merged = [...flows.values()].flatMap((flow) => [...flow.merged]);
    const events = changeLandedEvents(merged, mateProjectId);
    return events.length === 0 ? NONE : events;
  }, [candidates, environmentId, flows]);
}
