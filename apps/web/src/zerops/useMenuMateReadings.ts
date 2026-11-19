import { lastKnownMateWords, MATE_AWAY_GRACE_MS } from "./lastKnownMate.logic";
import { useProjectsActivityRead } from "./activity/useProjectActivity";
/**
 * How the left menu reads each Mate it draws: what its row says (`useMateRowActivity` — its
 * attention as the account's store holds it, at rest while that word is not of now) and
 * whether it is still in its first minutes (`mateComing` — its birth, its project on the way up,
 * the platform's verdict on its creation, this tab's creation). The menu, the folded headings and
 * the waiting faces read the same answers; the projects page reads the same words.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { MatePresence } from "@t3tools/shared/hqMates";
import {
  applyProjectCreationVerdict,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { Atom } from "effect/reactivity";
import {
  accountReadsAtom,
  mateLink as mateLinkProjection,
  hqMatePresenceAtom,
  hqProjectPersonAtom,
  mateAttentionAtom,
  shownAttentionProjectsAtom,
} from "@t3tools/client-runtime/data";
import { useCallback, useMemo, useState } from "react";

import { environmentsWithSnapshotAtom } from "../state/shell";
import { hqMainChatsAtom } from "../state/zerops";
import { restingActivity, type ZeropsAgentActivity } from "./agentActivity";
import { mateActivityAtom } from "./mateActivityAtoms";
import type { MatesActivity } from "./useZeropsAgentActivity";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { mateArrival, mateComingDeadlines, type MateComing } from "@t3tools/client-runtime/data";
import { useWakeAt } from "./useNowMs";
import { useCreations } from "./creations";
import { madeOf, type NewProjectBirth } from "./newProjectBirth";
import { useProjectCreations } from "./useProjectCreations";
import { useZeropsFirstBuilds } from "./useZeropsFirstBuilds";
import { usePressesElsewhere } from "./usePressesElsewhere";
import { pressComingInput, useMatePresses } from "./matePress";
import { birthClock, sharedBirthPresentation, useSharedBirthState } from "./sharedBirths";

/**
 * What a Mate's row says (`useMatesActivity`), for a candidate the menu lists: by its project, else
 * by the environment its connected socket runs.
 */
export function useMateRowActivity(
  activity: MatesActivity,
): (candidate: ZeropsCandidate) => ZeropsAgentActivity | undefined {
  return useCallback(
    (candidate: ZeropsCandidate) =>
      activity.ofProject(candidate.project.id) ??
      (candidate.group === "connected" && candidate.environmentId !== undefined
        ? activity.ofEnvironment(candidate.environmentId)
        : undefined),
    [activity],
  );
}

/**
 * The main chat HQ names for each Mate, by its project — its overview's main chat in its
 * environment: what opening a Mate this page holds no socket to routes to, the route connecting it.
 */
export function useHqMainChats(): (projectId: string) => ScopedThreadRef | undefined {
  const chats = useAtomValue(hqMainChatsAtom);
  return useCallback((projectId: string) => chats[projectId]?.chat, [chats]);
}

/**
 * Whether HQ last relayed that a Mate's link to it is open (HQ away says nothing of it): one answer per Mate, so a row redraws
 * when its own link opens or closes, not on every word HQ relays of any Mate.
 */
export function useMateLinkedInHq(projectId: string): boolean {
  return useAtomValue(mateLinkedInHqAtom(projectId));
}

const mateLinkedInHqAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    return get(hqMatePresenceAtom(projectId))?.online === true;
  }),
);

/**
 * What HQ holds of a Mate's overview (its presence's `overview`), `undefined` while HQ relays no
 * presence of it: whether HQ has ever heard the Mate, which decides if its row may speak of a
 * sign-in (`mateOwnerView`).
 */
export function useMateOverviewInHq(projectId: string): MatePresence["overview"] | undefined {
  return useAtomValue(mateOverviewInHqAtom(projectId));
}

const mateOverviewInHqAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    return get(hqMatePresenceAtom(projectId))?.overview;
  }),
);

/**
 * Whom HQ relays as linked, for every Mate the menu shows (`mateAwake`'s second fact): the menu's
 * rows and the overview's faces read one map, which changes only when some Mate's link opens or
 * closes.
 */
export function useMatesLinkedInHq(): ReadonlyMap<
  string,
  { readonly presence: import("@t3tools/shared/hqMates").MatePresence }
> {
  return useAtomValue(matesLinkedInHqAtom);
}

const matesLinkedInHqAtom = Atom.make((get) => {
  const mates = new Map<
    string,
    { readonly presence: import("@t3tools/shared/hqMates").MatePresence }
  >();
  for (const id of get(shownAttentionProjectsAtom)) {
    const presence = get(hqMatePresenceAtom(id));
    if (presence !== null) mates.set(id, { presence });
  }
  return mates;
}).pipe(
  Atom.withEquality(
    (
      a: ReadonlyMap<string, { readonly presence: import("@t3tools/shared/hqMates").MatePresence }>,
      b,
    ) =>
      a.size === b.size &&
      [...a].every(([id, mate]) => b.get(id)?.presence.online === mate.presence.online),
  ),
);

/**
 * A Mate's one answer, at rest — what its menu row reads (`mateActivityAtom`), with nothing only
 * true now, its time that answer's own; undefined where that answer is.
 */
export function useToldActivity(projectId: string): ZeropsAgentActivity | undefined {
  const activity = useAtomValue(mateActivityAtom(projectId));
  return useMemo(
    () => (activity === undefined ? undefined : restingActivity(activity)),
    [activity],
  );
}

export function useLastKnownMateWords(
  projectId: string | null | undefined,
  name: string,
): string | undefined {
  return lastKnownMateWords(useToldActivity(projectId ?? ""), name);
}

/**
 * Whether a Mate's row may say "Nothing asked yet" without taking it back: its attention value is
 * known — a row's words come off it (`mateActivityAtom`), so none known yet says nothing of what
 * was asked —, and HQ's overview names its chats and HQ's person facts of its project are read, or
 * its connected environment's shell arrived. Until then the row's line stays empty. The menu and
 * the projects page read this one answer.
 */
export const mateConversationsReadAtom = Atom.make((get) => {
  const read = get(environmentsWithSnapshotAtom);
  const told = new Set(get(hqMatesWithMainAtom).split("\n"));
  const attended = new Set(get(matesWithAttentionAtom).split("\n"));
  return (candidate: Pick<ZeropsCandidate, "project" | "group" | "environmentId">) =>
    attended.has(candidate.project.id) &&
    (told.has(candidate.project.id) ||
      (candidate.group === "connected" &&
        candidate.environmentId !== undefined &&
        read.has(candidate.environmentId)));
}).pipe(Atom.withLabel("mate-conversations-read"));

export function useMateConversationsRead(): (candidate: ZeropsCandidate) => boolean {
  return useAtomValue(mateConversationsReadAtom);
}

/**
 * The Mates HQ told what outranks "Nothing asked yet" besides their attention — its overview names
 * their main chat and their project's person facts are read — as one key: it changes when one
 * gains or loses that, not on every word HQ relays.
 */
const hqMatesWithMainAtom = Atom.make((get) => {
  const ids: string[] = [];
  for (const [projectId, mate] of Object.entries(get(hqMainChatsAtom))) {
    if (mate.read && get(hqProjectPersonAtom(projectId))?.everSignedIn !== undefined) {
      ids.push(projectId);
    }
  }
  return ids.join("\n");
}).pipe(Atom.withLabel("hq-mates-with-main"));

/** The Mates whose attention value is known, as one key: it changes when one gains or loses it. */
const matesWithAttentionAtom = Atom.make((get) =>
  get(shownAttentionProjectsAtom)
    .filter((projectId) => get(mateAttentionAtom(projectId)).attention !== null)
    .join("\n"),
).pipe(Atom.withLabel("mates-with-attention"));

/**
 * Whether a Mate the menu lists is still in its first minutes, as its row says it: its press made
 * in this browser, its project on the way up, its address landed and its Mate not answering yet,
 * the platform's verdict on its creation and its first build's process (read as the projects page
 * reads them), its press in another browser as HQ holds it, or a step of this tab's creation that
 * failed.
 */
export function useMateComingOf(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (candidate: ZeropsCandidate) => MateComing | undefined {
  const { open: births, readyProjectIds } = useSharedBirthState();
  const presses = useMatePresses();
  const creations = useCreations();
  const { mateLink } = useEnvironmentLinks();
  const verdicts = useProjectCreations(candidates);
  const firstBuilds = useZeropsFirstBuilds(candidates);
  const processFacts = useProjectsActivityRead(candidates.map((candidate) => candidate.project.id));
  const pressOf = usePressesElsewhere(candidates);
  const wokeAt = useComingClock(candidates, creations);
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const birth = births.find((entry) => entry.projectId === candidate.project.id);
      if (birth !== undefined) {
        const shown = sharedBirthPresentation(birth);
        return {
          kind: "coming",
          line: shown.row,
          birth: { attention: shown.attention },
          since: birthClock(birth, madeOf(creations, candidate.project.id)?.startedAt),
        };
      }
      const made = madeOf(creations, candidate.project.id);
      // Its birth over at HQ, a Mate this tab made is still on its way here until its link opens
      // (`mateArrival`): its row keeps its clock while its own view keeps its steps.
      if (readyProjectIds.includes(candidate.project.id) && made === undefined) return undefined;
      const { press, setUpFailed } = pressComingInput(presses, candidate.project.id);
      return mateArrival({
        press,
        candidate: applyProjectCreationVerdict(candidate, verdicts.get(candidate.project.id)),
        setUpFailed: setUpFailed ?? made?.failed?.reason,
        // A new getter at each deadline (`useComingClock`): the menu is memoised, and nothing
        // else may change then.
        nowMs: Math.max(Date.now(), wokeAt),
        created: made !== undefined,
        madeAt: made?.startedAt,
        processes: processFacts[candidate.project.id]?.processes,
        link: mateLink(candidate),
        firstBuild: firstBuilds.get(candidate.key),
        pressElsewhere: pressOf(candidate.project.id),
      }).coming;
    },
    [
      births,
      readyProjectIds,
      presses,
      creations,
      firstBuilds,
      mateLink,
      pressOf,
      verdicts,
      wokeAt,
      processFacts,
    ],
  );
}

const NO_CREATIONS: ReadonlyArray<NewProjectBirth> = [];

/**
 * The moment a listed Mate's coming-up line may last have changed by time alone
 * (`mateComingDeadlines`): its arrival's window closing, its first build's grace running out,
 * and the catch-up of one this tab made ending. The line's getter is a new function at each, and
 * the menu's list reads it anew only then: a deadline left out here is a line that stays.
 */
export function useComingClock(
  candidates: ReadonlyArray<ZeropsCandidate>,
  creations: ReadonlyArray<NewProjectBirth> = NO_CREATIONS,
): number {
  return useWakeAt(
    useMemo(
      () =>
        candidates.flatMap((candidate) =>
          mateComingDeadlines(candidate, madeOf(creations, candidate.project.id)?.startedAt),
        ),
      [candidates, creations],
    ),
  );
}

/** The socket-loss timestamp is read through the target's keyed account state. */
export const mateSocketLostAtAtom = Atom.family((key: string) =>
  Atom.make((get): number | undefined => {
    const account = get(accountReadsAtom);
    if (account === null) return undefined;
    return get(account.data.project(mateLinkProjection, key))?.environment.linkLostAt?.wall;
  }),
);

/** HQ transport loss is not evidence that a Mate went offline. */
export function useMateOfflineSince(
  projectId: string | null | undefined,
  key?: string,
): string | undefined {
  const presence = useAtomValue(hqMatePresenceAtom(projectId ?? ""));
  const lostAt = useAtomValue(mateSocketLostAtAtom(key ?? projectId ?? ""));
  return lostAt === undefined
    ? presence?.online === false
      ? presence.since
      : undefined
    : new Date(lostAt).toISOString();
}

/**
 * Now, for how long a Mate has been away (`mateAwaySettling`): the later of the moment its grace
 * ran out while this row watched and the moment this row learned the current `offlineSince`. A row
 * that waited out a restart says it isn't answering on time, and only then; a row that learns of
 * the absence after the grace (HQ's word reaches a tab without a socket ~60 s late) says it at
 * once, never treating old news as a blink. The learned moment follows `offlineSince` back to
 * `undefined`, so a later stop is learned afresh.
 */
export function useMateAwayNow(offlineSince: string | undefined): number {
  const graceEnds =
    offlineSince === undefined ? Number.NaN : Date.parse(offlineSince) + MATE_AWAY_GRACE_MS;
  const wokeAt = useWakeAt(Number.isFinite(graceEnds) ? [graceEnds] : []);
  const [learned, setLearned] = useState(() => ({ since: offlineSince, at: Date.now() }));
  if (learned.since !== offlineSince) {
    const next = { since: offlineSince, at: Date.now() };
    setLearned(next);
    return Math.max(wokeAt, next.at);
  }
  return Math.max(wokeAt, learned.at);
}
