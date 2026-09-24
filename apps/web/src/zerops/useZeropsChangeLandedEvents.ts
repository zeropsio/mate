/**
 * The landings of a conversation's Mate, and the ones its timeline places.
 *
 * A Mate's message is frozen when it is written, so what it said about a change
 * stops being true the moment somebody merges (the owner, 2026-09-20). The chip
 * inside the message says where the change stands now; the timeline says when it
 * moved, in the place a person reads the work in order.
 *
 * Every group's landed changes are handed to `changeLandedEvents` together: it
 * keeps the ones belonging to this conversation's Mate, so no group has to be
 * looked up here. Outside a Zerops session there is no flow and no Mate, and it
 * takes nothing.
 *
 * A Mate has many conversations and its landings are all of theirs. The Mate is
 * told of every one; a timeline places only the ones its own messages named
 * (the owner, 2026-09-24: a long conversation opened on a stack of landings that
 * "belong to the previous conversations").
 */
import {
  changeLandedEvents,
  parseGiteaChangeUrl,
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

/** A url as prose and markdown carry it: up to whitespace, a bracket or a quote. */
const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"'`]+/gu;
/** What ends a sentence around a url rather than the url itself. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

type SaidMessage = { readonly text: string; readonly createdAt: string };

/**
 * Messages are immutable and the list is re-read on every streamed token, so each message is
 * scanned once per forge.
 */
const mentionsByMessage = new WeakMap<
  SaidMessage,
  { origin: string; changes: ReadonlyArray<string> }
>();

/** `repository#number` of every change on this forge the message links to. */
function mentionedChanges(message: SaidMessage, giteaOrigin: string): ReadonlyArray<string> {
  const cached = mentionsByMessage.get(message);
  if (cached?.origin === giteaOrigin) return cached.changes;
  const changes: Array<string> = [];
  for (const [url] of message.text.matchAll(URL_IN_TEXT)) {
    const change = parseGiteaChangeUrl(url.replace(TRAILING_PUNCTUATION, ""), giteaOrigin);
    if (change !== null) changes.push(`${change.repository}#${String(change.number)}`);
  }
  mentionsByMessage.set(message, { origin: giteaOrigin, changes });
  return changes;
}

/**
 * The landings a conversation places: the changes its loaded messages link to, landed after the
 * first of them. A landing earlier than that would sit above everything that is loaded, cut off
 * from the message that named it; it is placed once the turns before it are.
 */
export function conversationLandings(
  events: ReadonlyArray<ChangeLandedEvent>,
  messages: ReadonlyArray<SaidMessage>,
  giteaOrigin: string | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  const first = messages[0];
  if (events.length === 0 || first === undefined || giteaOrigin === undefined) return NONE;
  const mentioned = new Set(messages.flatMap((message) => mentionedChanges(message, giteaOrigin)));
  const placed = events.filter(
    (event) =>
      mentioned.has(`${event.repository}#${String(event.number)}`) &&
      event.landedAt >= first.createdAt,
  );
  return placed.length === 0 ? NONE : placed;
}

export function useZeropsConversationLandings(
  events: ReadonlyArray<ChangeLandedEvent>,
  messages: ReadonlyArray<SaidMessage>,
): ReadonlyArray<ChangeLandedEvent> {
  const giteaOrigin = useZeropsProjectFlowOptional()?.giteaOrigin;
  return useMemo(
    () => conversationLandings(events, messages, giteaOrigin),
    [events, messages, giteaOrigin],
  );
}
