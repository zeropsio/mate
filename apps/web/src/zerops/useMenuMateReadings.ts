import { lastKnownMateWords, MATE_AWAY_GRACE_MS } from "./lastKnownMate.logic";
import { attentionActivity } from "./mateActivity";
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
  hqMateOverviewAtom,
  hqMatePresenceAtom,
  mateAttentionAtom,
  shownAttentionProjectsAtom,
} from "@t3tools/client-runtime/data";
import { useCallback, useMemo, useState } from "react";

import { environmentsWithSnapshotAtom } from "../state/shell";
import { hqMainChatsAtom } from "../state/zerops";
import { overviewAgentActivity, type ZeropsAgentActivity } from "./agentActivity";
import type { MatesActivity } from "./useZeropsAgentActivity";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { mateArrival, mateComingDeadlines, type MateComing } from "@t3tools/client-runtime/data";
import { useWakeAt } from "./useNowMs";
import { useCreations } from "./creations";
import { madeOf } from "./newProjectBirth";
import { useProjectCreations } from "./useProjectCreations";
import { useCloseOffHolds } from "./accountEnvironments";
import { useZeropsFirstBuilds } from "./useZeropsFirstBuilds";
import { usePressesElsewhere } from "./usePressesElsewhere";
import { closeOffOpenOf, pressComingInput, useMatePresses } from "./matePress";

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
 * Whether HQ relays now that a Mate's link to it is open: one answer per Mate, so a row redraws
 * when its own link opens or closes, not on every word HQ relays of any Mate.
 */
export function useMateLinkedInHq(projectId: string): boolean {
  return useAtomValue(mateLinkedInHqAtom(projectId));
}

const mateLinkedInHqAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    const read = get(hqMatePresenceAtom(projectId));
    return read.live && read.presence?.online === true;
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
    const read = get(hqMatePresenceAtom(projectId));
    return read.live ? read.presence?.overview : undefined;
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
    const fact = get(hqMatePresenceAtom(id));
    if (fact.live && fact.presence !== null) mates.set(id, { presence: fact.presence });
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
 * What HQ last told of a Mate, as its menu row reads it, at rest — the conversation its row stands
 * for and what it is on; undefined where HQ holds no overview of it, or it has no main chat yet.
 */
export function useToldActivity(projectId: string): ZeropsAgentActivity | undefined {
  const told = useAtomValue(hqMateOverviewAtom(projectId)) ?? undefined;
  const read = useAtomValue(mateAttentionAtom(projectId));
  return useMemo(() => {
    if (told === undefined) return undefined;
    if (read.attention === null) return overviewAgentActivity(told, false, {});
    return attentionActivity({
      attention: read.attention,
      live: false,
      unseen: read.unseen,
      environmentId: read.attention.source.environmentId,
      overview: told,
      shells: [],
      followed: false,
      lastVisitedAtById: {},
    });
  }, [told, read]);
}

export function useLastKnownMateWords(
  projectId: string | null | undefined,
  name: string,
): string | undefined {
  return lastKnownMateWords(useToldActivity(projectId ?? ""), name);
}

/**
 * Whether a Mate's conversations have been read — HQ told of them, or its connected environment's
 * shell arrived — so a Mate with none has nothing asked yet, and its row may say so without taking
 * it back.
 */
export function useMateConversationsRead(): (candidate: ZeropsCandidate) => boolean {
  const read = useAtomValue(environmentsWithSnapshotAtom);
  const toldKey = useAtomValue(hqMatesWithMainAtom);
  const told = useMemo(() => new Set(toldKey.split("\n")), [toldKey]);
  return useCallback(
    (candidate: ZeropsCandidate) =>
      told.has(candidate.project.id) ||
      (candidate.group === "connected" &&
        candidate.environmentId !== undefined &&
        read.has(candidate.environmentId)),
    [told, read],
  );
}

/**
 * The Mates whose main chat HQ's overview names, as one key: it changes when one gains or loses
 * it, not on every word HQ relays.
 */
const hqMatesWithMainAtom = Atom.make((get) => {
  const ids: string[] = [];
  for (const [projectId, mate] of Object.entries(get(hqMainChatsAtom))) {
    if (mate.read) ids.push(projectId);
  }
  return ids.join("\n");
}).pipe(Atom.withLabel("hq-mates-with-main"));

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
  const presses = useMatePresses();
  const creations = useCreations();
  const { mateLink } = useEnvironmentLinks();
  const closeOffHolds = useCloseOffHolds();
  const verdicts = useProjectCreations(candidates);
  const firstBuilds = useZeropsFirstBuilds(candidates);
  const processFacts = useProjectsActivityRead(candidates.map((candidate) => candidate.project.id));
  const pressOf = usePressesElsewhere(candidates);
  const wokeAt = useComingClock(candidates);
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const { press, setUpFailed } = pressComingInput(presses, candidate.project.id);
      const made = madeOf(creations, candidate.project.id);
      return mateArrival({
        press,
        // A row says only the hold it offers Finish setup for; the others, its own view.
        closeOffHold: closeOffOpenOf(
          closeOffHolds,
          candidate.project.id,
          presses.find((entry) => entry.projectId === candidate.project.id),
        )
          ? "open"
          : undefined,
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
      presses,
      creations,
      firstBuilds,
      mateLink,
      pressOf,
      verdicts,
      closeOffHolds,
      wokeAt,
      processFacts,
    ],
  );
}

/**
 * The moment a listed Mate's coming-up line may last have changed by time alone
 * (`mateComingDeadlines`): its arrival's window closing, its first build's grace running out.
 */
export function useComingClock(candidates: ReadonlyArray<ZeropsCandidate>): number {
  return useWakeAt(useMemo(() => candidates.flatMap(mateComingDeadlines), [candidates]));
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
  const read = useAtomValue(hqMatePresenceAtom(projectId ?? ""));
  const lostAt = useAtomValue(mateSocketLostAtAtom(key ?? projectId ?? ""));
  return lostAt === undefined
    ? read.live && read.presence?.online === false
      ? read.presence.since
      : undefined
    : new Date(lostAt).toISOString();
}

/**
 * Now, for how long a Mate has been away (`mateAwaySettling`): it moves when its grace runs out,
 * so a row that waited out a restart says it isn't answering on time, and only then.
 */
export function useMateAwayNow(offlineSince: string | undefined): number {
  const graceEnds =
    offlineSince === undefined ? Number.NaN : Date.parse(offlineSince) + MATE_AWAY_GRACE_MS;
  const wokeAt = useWakeAt(Number.isFinite(graceEnds) ? [graceEnds] : []);
  const [mountedAt] = useState(() => Date.now());
  return Math.max(wokeAt, mountedAt);
}
