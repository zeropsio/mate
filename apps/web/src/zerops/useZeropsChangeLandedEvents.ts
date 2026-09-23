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
import {
  changeLandedEvents,
  type ChangeLandedEvent,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { findCandidate, type CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import { useZeropsProjectFlowOptional } from "./projectFlowContext";
import { useZeropsCandidates } from "./useZeropsCandidates";

const NONE: ReadonlyArray<ChangeLandedEvent> = [];

/**
 * The landings of the Mate that lives in `environmentId`. Which Mate that is comes from the
 * listing; until it names one, no landing is placed — a timeline without them says nothing, where
 * one with another Mate's would say something false.
 */
export function changeLandedEventsFor(
  listing: Shown<ReadonlyArray<CandidateRow>>,
  environmentId: string,
  flows: ReadonlyMap<string, { readonly merged: ReadonlyArray<FlowPullRequest> }>,
): ReadonlyArray<ChangeLandedEvent> {
  const mate = findCandidate(
    listing,
    (candidate) => String(candidate.environmentId) === environmentId,
  );
  if (mate.kind !== "found") return NONE;
  const merged = [...flows.values()].flatMap((flow) => [...flow.merged]);
  const events = changeLandedEvents(merged, mate.row.project.id);
  return events.length === 0 ? NONE : events;
}

export function useZeropsChangeLandedEvents(
  environmentId: string | null | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  const flowValue = useZeropsProjectFlowOptional();
  const { listing } = useZeropsCandidates();
  const flows = flowValue?.flows;
  return useMemo(() => {
    if (environmentId === null || environmentId === undefined || flows === undefined) return NONE;
    return changeLandedEventsFor(listing, String(environmentId), flows);
  }, [environmentId, flows, listing]);
}
