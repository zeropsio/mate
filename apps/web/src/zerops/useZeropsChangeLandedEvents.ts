/**
 * The landings of a conversation's Mate, and the ones its timeline places.
 *
 * A Mate's message is frozen when it is written, so what it said about a change
 * stops being true the moment somebody merges (the owner, 2026-09-20). The chip
 * inside the message says where the change stands now; the timeline says when it
 * moved, in the place a person reads the work in order.
 *
 * The Mate's application's landed changes are read while its conversation is
 * drawn, and `changeLandedEvents` keeps the ones belonging to this Mate.
 * Outside a Zerops session there is no Mate, and it takes nothing.
 *
 * A Mate has many conversations and its landings are all of theirs. The Mate is
 * told of every one; a timeline places only the ones its own messages named
 * (the owner, 2026-09-24: a long conversation opened on a stack of landings that
 * "belong to the previous conversations").
 */
import {
  changeLandedEvents,
  linkedChanges,
  productionRelease,
  readZeropsMembership,
  releaseCreationsFailed,
  releaseEndedEvents,
  releaseFailure,
  type ChangeLandedEvent,
  type FlowPullRequest,
  type ProductionLive,
  type ReleaseEndedEvent,
} from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { findCandidate, type CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo, useState } from "react";

import { useProductionAddresses } from "../components/zerops/review/reviewReads";
import {
  useAppsChanges,
  useAppsEnvironments,
  useCompactProjectFlows,
  useHqAddress,
} from "./projectFlows";
import { useHqAppDetailHold } from "./useHqAppDetail";
import { useHeldZeropsDetailCandidates } from "./useZeropsCandidates";

const NONE: ReadonlyArray<ChangeLandedEvent> = [];

/** The Mate that lives in `environmentId`, as the listing names it; none until it does. */
function mateIn(
  listing: Shown<ReadonlyArray<CandidateRow>>,
  environmentId: string,
): CandidateRow | undefined {
  const mate = findCandidate(
    listing,
    (candidate) => String(candidate.environmentId) === environmentId,
  );
  return mate.kind === "found" ? mate.row : undefined;
}

/**
 * The landings of the Mate that lives in `environmentId`. Which Mate that is comes from the
 * listing; until it names one, no landing is placed — a timeline without them says nothing, where
 * one with another Mate's would say something false.
 */
export function changeLandedEventsFor(
  listing: Shown<ReadonlyArray<CandidateRow>>,
  environmentId: string,
  changes: ReadonlyMap<string, { readonly merged: ReadonlyArray<FlowPullRequest> }>,
): ReadonlyArray<ChangeLandedEvent> {
  const mate = mateIn(listing, environmentId);
  if (mate === undefined) return NONE;
  const merged = [...changes.values()].flatMap((app) => [...app.merged]);
  const events = changeLandedEvents(merged, mate.project.id);
  return events.length === 0 ? NONE : events;
}

/**
 * Holds the application detail of the Mate that lives in `environmentId` while its conversation is
 * drawn: its landings are that detail's, and nothing else holds it for a conversation.
 */
export function useZeropsMateAppDetailHold(environmentId: string | null | undefined): void {
  const rows = useHeldZeropsDetailCandidates();
  const mate =
    environmentId === null || environmentId === undefined
      ? undefined
      : rows.find((candidate) => String(candidate.environmentId) === environmentId);
  const groupId = mate === undefined ? undefined : readZeropsMembership(mate.project).groupId;
  useHqAppDetailHold(groupId === undefined || groupId === null ? [] : [groupId]);
}

const NO_APPS: ReadonlyArray<string> = [];

/**
 * The Mate that lives in `environmentId`, as the listing has it. A listing row names its
 * environment only while its link is up, so the project found last stands in while the same
 * environment is asked for and its link is down: what a conversation shows of its application (a
 * landed change, how a release ended) stays in its timeline through a reconnect instead of
 * leaving it and coming back, moving everything under it twice.
 */
function useMateOfEnvironment(environmentId: string | null | undefined) {
  const rows = useHeldZeropsDetailCandidates();
  const linked = rows.find((row) => String(row.environmentId) === environmentId);
  const [last, setLast] = useState<
    { readonly environmentId: string; readonly projectId: string } | undefined
  >(undefined);
  if (
    linked !== undefined &&
    typeof environmentId === "string" &&
    (last?.environmentId !== environmentId || last.projectId !== linked.project.id)
  )
    setLast({ environmentId, projectId: linked.project.id });
  if (linked !== undefined) return linked;
  return last !== undefined && last.environmentId === environmentId
    ? rows.find((row) => row.project.id === last.projectId)
    : undefined;
}

export function useZeropsChangeLandedEvents(
  environmentId: string | null | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  const mate = useMateOfEnvironment(environmentId);
  // Only the Mate's own application's changes are read, while its conversation is drawn.
  const groupId = mate === undefined ? undefined : readZeropsMembership(mate.project).groupId;
  const appIds = useMemo(() => (groupId === undefined ? NO_APPS : [groupId]), [groupId]);
  const { changes } = useAppsChanges(appIds);
  return useMemo(() => {
    if (mate === undefined) return NONE;
    const events = changeLandedEvents(
      [...changes.values()].flatMap((app) => [...app.merged]),
      mate.project.id,
    );
    return events.length === 0 ? NONE : events;
  }, [changes, mate]);
}

/**
 * The release the application's production runs, and where it answers, for the Mate that lives in
 * `environmentId`: what its next turn is told once that release is newer than its last words
 * (`productionTurnNotes`). None outside an application, or before a release runs there.
 */
export function useZeropsProductionLive(
  environmentId: string | null | undefined,
): ProductionLive | undefined {
  const mate = useMateOfEnvironment(environmentId);
  const groupId = mate === undefined ? undefined : readZeropsMembership(mate.project).groupId;
  const appIds = useMemo(() => (groupId === undefined ? NO_APPS : [groupId]), [groupId]);
  const live = productionRelease(useCompactProjectFlows(appIds).flows.get(groupId ?? ""));
  const address = useProductionAddresses(live?.projectId)[0]?.url;
  const tag = live?.tag;
  const taggedAt = live?.taggedAt;
  return useMemo(
    () => (tag === undefined || taggedAt === undefined ? undefined : { tag, taggedAt, address }),
    [address, tag, taggedAt],
  );
}

type SaidMessage = { readonly text: string; readonly createdAt: string };

/**
 * Messages are immutable and the list is re-read on every streamed token, so each message is
 * scanned once per official HQ.
 */
const mentionsByMessage = new WeakMap<
  SaidMessage,
  { hqAddress: string; changes: ReadonlyArray<string> }
>();

/** `repository#number` of every change at the official HQ the message links to. */
function mentionedChanges(message: SaidMessage, hqAddress: string): ReadonlyArray<string> {
  const cached = mentionsByMessage.get(message);
  if (cached?.hqAddress === hqAddress) return cached.changes;
  const changes = linkedChanges(message.text, hqAddress).map(
    (link) => `${link.repo}#${String(link.number)}`,
  );
  mentionsByMessage.set(message, { hqAddress, changes });
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
  hqAddress: string | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  const first = messages[0];
  if (events.length === 0 || first === undefined || hqAddress === undefined) return NONE;
  const mentioned = new Set(messages.flatMap((message) => mentionedChanges(message, hqAddress)));
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
  const hqAddress = useHqAddress();
  return useMemo(
    () => conversationLandings(events, messages, hqAddress),
    [events, messages, hqAddress],
  );
}

const NO_ENDS: ReadonlyArray<ReleaseEndedEvent> = [];

/** The application `projectId` is in, as the listing tags it; none until it names one. */
export function useAppOfProject(projectId: string | undefined): string | undefined {
  const rows = useHeldZeropsDetailCandidates();
  const row =
    projectId === undefined ? undefined : rows.find((each) => each.project.id === projectId);
  return row === undefined ? undefined : (readZeropsMembership(row.project).groupId ?? undefined);
}

/**
 * How the application's production releases ended, oldest first (`releaseEndedEvents`): read from
 * its flow's releases and production's jobs as HQ lists them, so a reload says the same. The same
 * events while nothing of them changed, so a timeline keyed on them keeps its rows.
 */
export function useAppReleaseEnded(groupId: string | undefined): ReadonlyArray<ReleaseEndedEvent> {
  const appIds = useMemo(() => (groupId === undefined ? NO_APPS : [groupId]), [groupId]);
  const flow = useCompactProjectFlows(appIds).flows.get(groupId ?? "");
  const production = useAppsEnvironments(appIds)[groupId ?? ""]?.environments?.find(
    (environment) => environment.tier === "production",
  );
  const events = useMemo(() => {
    if (flow === undefined || !flow.releasesKnown) return NO_ENDS;
    const reads = { environmentInputs: flow.environmentInputs, stalled: flow.release.stalled };
    return releaseEndedEvents({
      releases: flow.releases,
      failureOf: (release) => releaseFailure(release, reads),
      creations: releaseCreationsFailed(production?.jobs ?? []),
      rollout: production?.release,
    });
  }, [flow, production]);
  // The flow is read again with every fact that moves under it: the events it comes to are kept
  // while they say the same.
  const [held, setHeld] = useState(events);
  if (held !== events && JSON.stringify(held) !== JSON.stringify(events)) setHeld(events);
  return held;
}

/** How the releases of the application of the Mate that lives in `environmentId` ended. */
export function useZeropsReleaseEnded(
  environmentId: string | null | undefined,
): ReadonlyArray<ReleaseEndedEvent> {
  const mate = useMateOfEnvironment(environmentId);
  const groupId = mate === undefined ? undefined : readZeropsMembership(mate.project).groupId;
  return useAppReleaseEnded(groupId ?? undefined);
}

/**
 * The releases a conversation places: those that carried a change its Mate made or its loaded
 * messages link to (as each release recorded what it put live), and those made after one of its
 * production asks —
 * each one from the ask up to the first that did not fail — that ended after its first loaded
 * message. A Mate's other conversations stay free of releases that were never theirs.
 */
export function conversationReleases(input: {
  readonly events: ReadonlyArray<ReleaseEndedEvent>;
  /** The application's releases, newest first, with the changes each recorded. */
  readonly releases: ReadonlyArray<{
    readonly tag: string;
    readonly taggedAt: string;
    readonly history?:
      | { readonly changes: ReadonlyArray<{ readonly repo: string; readonly number: number }> }
      | undefined;
  }>;
  readonly messages: ReadonlyArray<SaidMessage>;
  readonly hqAddress: string | undefined;
  /** When each production ask of the conversation was raised. */
  readonly asks: ReadonlyArray<string>;
  /** The changes the conversation's own Mate made, as `repo#number`: a release of its work is its. */
  readonly mine?: ReadonlySet<string> | undefined;
}): ReadonlyArray<ReleaseEndedEvent> {
  const { events, releases, messages, hqAddress } = input;
  const first = messages[0];
  if (events.length === 0 || first === undefined) return NO_ENDS;
  const mentioned = new Set(
    hqAddress === undefined
      ? []
      : messages.flatMap((message) => mentionedChanges(message, hqAddress)),
  );
  const ours = new Set(
    releases.flatMap((release) =>
      release.history?.changes.some((change) => {
        const key = `${change.repo}#${String(change.number)}`;
        return mentioned.has(key) || input.mine?.has(key) === true;
      }) === true
        ? [release.tag]
        : [],
    ),
  );
  const failed = new Set(
    events.flatMap((event) => (event.outcome === "failed" ? [event.tag] : [])),
  );
  const oldestFirst = releases.toReversed();
  for (const askedAt of input.asks) {
    for (const release of oldestFirst) {
      if (!(Date.parse(release.taggedAt) > Date.parse(askedAt))) continue;
      ours.add(release.tag);
      if (!failed.has(release.tag)) break;
    }
  }
  const placed = events.filter((event) => ours.has(event.tag) && event.endedAt >= first.createdAt);
  return placed.length === 0 ? NO_ENDS : placed;
}

export function useZeropsConversationReleases(
  environmentId: string | null | undefined,
  events: ReadonlyArray<ReleaseEndedEvent>,
  messages: ReadonlyArray<SaidMessage>,
  asks: ReadonlyArray<string>,
): ReadonlyArray<ReleaseEndedEvent> {
  const hqAddress = useHqAddress();
  const mate = useMateOfEnvironment(environmentId);
  const groupId = mate === undefined ? undefined : readZeropsMembership(mate.project).groupId;
  const appIds = useMemo(
    () => (groupId === undefined || groupId === null ? NO_APPS : [groupId]),
    [groupId],
  );
  const flow = useCompactProjectFlows(appIds).flows.get(groupId ?? "");
  const releases = flow?.releases;
  // What the Mate itself made: a release that carried it is told in its conversation, whether or
  // not a message of it links the change.
  const mateProjectId = mate?.project.id;
  const merged = flow?.merged;
  const mine = useMemo(() => {
    const made = new Set<string>();
    // Until the flow is read nothing is known to be the Mate's, and no release is placed for it.
    if (merged === undefined) return made;
    for (const change of merged) {
      if (change.mateProjectId === mateProjectId) {
        made.add(`${change.repository}#${String(change.number)}`);
      }
    }
    return made;
  }, [mateProjectId, merged]);
  return useMemo(
    () =>
      releases === undefined
        ? NO_ENDS
        : conversationReleases({ events, releases, messages, hqAddress, asks, mine }),
    [asks, events, hqAddress, messages, mine, releases],
  );
}
