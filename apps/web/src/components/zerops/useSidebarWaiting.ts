/**
 * What needs the viewer — the one list every surface counts and says (`useViewerWaits`): the
 * menu's badge, its rail and its Needs you list, the overview's tab, a project's card and page —
 * and the way to the next one, ⌥↓ (`useWaitingNext`).
 *
 * The decision is `needsYou` (`waiting.logic.ts`), over what the data layer answers for each Mate:
 * its row's activity (the one resolver's word, R5), HQ's word of whom it waits on, its changes for
 * the viewer's review, its agent's sign-in, its crew's digest, its task and its attention; and
 * every project whose release is offered (`releaseOffered`) and theirs to make
 * (`useReleaseOnViewer`: being allowed to release a colleague's project is not being asked to).
 * It is always the viewer's: Mine / Everyone chooses which Mates the menu lists, never what waits
 * on them. The order is the menu's own (`sidebarReveal.ts`'s `mateOrder`), so "the next one" is
 * the next one down the list the viewer is looking at.
 */
import {
  assignCandidateMateTints,
  changeActBusy,
  hasMate,
  mateNextStep,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useCallback, useEffect, useMemo } from "react";

import { reviewQueueOrder } from "~/zerops/reviewQueue.logic";
import { useOrgTaskSource } from "~/zerops/useTaskSourceSettings";
import { useMenuProjects } from "~/components/zerops/SidebarOverview";
import {
  needsYou,
  releaseOffered,
  waitingProjectId,
  type NeedsYouCounts,
  type NeedsYouMate,
  type WaitingChange,
  type WaitingItem,
  type WaitingRelease,
} from "~/zerops/waiting.logic";

import { matesAttention, type MateAttentionRead } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/accountData";
import { mateReviewCount, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { crewTaskReviewable } from "~/zerops/crew/crewDigest";
import { useMateCrews } from "~/zerops/crew/useCrew";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useAppsChanges, useEveryAppId, useProjectFlows } from "~/zerops/projectFlows";
import { useAtomValue } from "@effect/atom-react";
import { applicationOperationsAtom } from "~/zerops/useEnvironmentOperation";
import { nextWaitingMate, useSidebarReveal } from "~/zerops/sidebarReveal";
import { useMenuRows } from "~/zerops/useMenuRows";
import { useMateRowActivity } from "~/zerops/useMenuMateReadings";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useChangeStandingOf } from "~/zerops/useChangeStandingOf";
import { useReleaseOnViewer } from "~/zerops/useReleaseOnViewer";
import { useSignInWaits } from "~/zerops/useSignInWaits";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

const NO_ATTENTION_READ: Readonly<Record<string, MateAttentionRead>> = {};
const NO_ATTENTION = Atom.make(NO_ATTENTION_READ);

/** The start of the viewer's day, in epoch milliseconds: what "done today" counts from. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * What needs the viewer among the candidates given, with every release offered: the one decision
 * (`needsYou`) over what the data layer answers for each Mate. The app reads it through
 * `useViewerWaits`; a design harness hands its own fixtures in.
 */
export function useWaitsOf<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** Every project whose next release is offered (`releaseOffered`). */
  readonly releases: ReadonlyArray<WaitingRelease>;
}): { readonly items: ReadonlyArray<WaitingItem>; readonly counts: NeedsYouCounts } {
  const { activityOf, candidates, releases } = input;
  const order = useSidebarReveal((state) => state.mateOrder);
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  // Its changes waiting for your review, read off the project flow the row reads.
  const { changes } = useAppsChanges(useEveryAppId());
  const waitsOnViewer = useWaitsOnViewer();
  const signInOf = useSignInWaits(candidates);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const crews = useMateCrews(
    useMemo(
      () => candidates.flatMap((candidate) => (hasMate(candidate) ? [candidate.project.id] : [])),
      [candidates],
    ),
  );
  const attention = useProjection(matesAttention, useAccountOrgId(), NO_ATTENTION);
  // Whose press each change waits for where its application limits who merges: one the person
  // already asked for waits on the people who merge, and is no wait of theirs.
  const standingOf = useChangeStandingOf();
  const reviewCount = useCallback(
    (candidate: T) => {
      const groupId = readZeropsMembership(candidate.project).groupId;
      return mateReviewCount(
        groupId === undefined ? undefined : changes.get(groupId),
        candidate.project.id,
        (pull) => standingOf(groupId, pull),
      );
    },
    [changes, standingOf],
  );
  // The change the review opens: the newest of its own waiting, as the composer's top reads it.
  const changeOf = useCallback(
    (candidate: T): WaitingChange | undefined => {
      const groupId = readZeropsMembership(candidate.project).groupId;
      if (groupId === undefined) return undefined;
      const step = mateNextStep({
        pullRequests: changes.get(groupId)?.pullRequests,
        mateProjectId: candidate.project.id,
        mateName: undefined,
        standingOf: (pull) => standingOf(groupId, pull),
      });
      if (step.kind !== "review") return undefined;
      // What waits on the person first: one somebody asked them to merge, one theirs to ask for —
      // never one they already asked for, or one whose merge is on its way, which the list is not
      // about (`mateNextStep`'s `waiting` counts neither).
      const waits =
        step.lines.find(
          (line) =>
            line.verdict === undefined && line.standing !== "waiting" && !changeActBusy(line.act),
        )?.pull ?? step.pull;
      // Two or more its person reviews themselves: its Review goes through them together.
      const queue = reviewQueueOrder(
        (step.queue ?? []).map((pull) => ({
          target: {
            kind: "change" as const,
            groupId,
            repository: pull.repository,
            number: pull.number,
          },
          buildsOn: pull.buildsOn,
        })),
      );
      // Its line names the change its Review opens: the queue's first, where it has one.
      const [first] = queue;
      const opens =
        (queue.length > 1 &&
          step.queue?.find(
            (pull) => pull.repository === first?.repository && pull.number === first.number,
          )) ||
        waits;
      return {
        groupId,
        repository: opens.repository,
        number: opens.number,
        title: opens.title,
        ...(standingOf(groupId, waits).standing.kind === "to-ask" ? { ask: true as const } : {}),
        ...(queue.length > 1
          ? { queue: queue.map(({ repository, number }) => ({ repository, number })) }
          : {}),
      };
    },
    [changes, standingOf],
  );
  const mates = useMemo(
    () =>
      candidates.flatMap((candidate): ReadonlyArray<NeedsYouMate> => {
        if (!hasMate(candidate)) return [];
        const projectId = candidate.project.id;
        const tint = tints.get(projectId) ?? "slate";
        const count = reviewCount(candidate);
        const crew = crews.get(projectId);
        const read = attention[projectId];
        const signIn = signInOf(candidate);
        const change = count > 0 ? changeOf(candidate) : undefined;
        const task = candidate.project.hq?.mate?.task;
        return [
          {
            projectId,
            name: projectNameInApp(candidate.project),
            tint,
            shape: mateShapeOf(candidate.project, tint),
            ...(candidate.environmentId === undefined
              ? {}
              : { environmentId: candidate.environmentId }),
            connected: candidate.group === "connected",
            mine: waitsOnViewer(projectId),
            activity: activityOf(candidate),
            ...(signIn === undefined ? {} : { signIn }),
            reviewCount: count,
            ...(change === undefined ? {} : { change }),
            ...(crew?.crew == null
              ? {}
              : {
                  crew: {
                    digest: crew.crew,
                    current: crew.current,
                    reviewable: crewTaskReviewable(crew.crew, crew.logins, viewerSubject),
                  },
                }),
            ...(task == null ? {} : { task }),
            ...(read?.attention == null
              ? {}
              : {
                  attention: {
                    live: read.live,
                    working: read.attention.working,
                    results: read.attention.results,
                  },
                }),
          },
        ];
      }),
    [
      activityOf,
      attention,
      candidates,
      changeOf,
      crews,
      reviewCount,
      signInOf,
      tints,
      viewerSubject,
      waitsOnViewer,
    ],
  );
  // What the person set aside until it changes, theirs on every device (HQ's snoozes).
  const snoozeRead = useOrgTaskSource("hqSnoozes").read.setting;
  const snoozes = snoozeRead.state === "known" ? snoozeRead.held : undefined;
  return useMemo(
    () =>
      needsYou({
        mates,
        order,
        releases,
        dayStart: startOfToday(),
        viewer: viewerSubject,
        snoozes,
      }),
    [mates, order, releases, snoozes, viewerSubject],
  );
}

/**
 * Every project of the organization whose next release is offered to the person, by the one gate:
 * what its card says is ready for production, whoever's move the release is.
 */
export function useOfferedReleases(): ReadonlyArray<WaitingRelease> {
  const projects = useMenuProjects();
  const flows = useProjectFlows("every").flows;
  const applicationOperations = useAtomValue(applicationOperationsAtom);
  return useMemo(
    () =>
      projects.flatMap((project) => {
        const release = flows.get(project.id)?.release;
        return release !== undefined &&
          releaseOffered({
            allowed: release.gate.allowed,
            recheck: release.git?.delivery?.recheck,
            putLive: applicationOperations.get(project.id),
          })
          ? [
              {
                groupId: project.id,
                name: project.name,
                ahead: release.summary?.total,
                changeCount: release.summary?.changeCount,
              },
            ]
          : [];
      }),
    [flows, projects, applicationOperations],
  );
}

/**
 * The offered releases that wait on the person (`useReleaseOnViewer`): in a project that is
 * theirs, or that names them, or that nobody else can release. An Owner is offered every
 * project's release; the others are their people's to make, and count for nothing here.
 */
function useWaitingReleases(): ReadonlyArray<WaitingRelease> {
  const offered = useOfferedReleases();
  const onViewer = useReleaseOnViewer();
  return useMemo(() => offered.filter((release) => onViewer(release.groupId)), [offered, onViewer]);
}

/**
 * What waits on the viewer, for every surface that counts or says it: the Mates the menu holds,
 * read as their rows read them, and every release offered. `text`: each Mate's own words too —
 * its question, its error — which the menu's count never reads, so it never redraws on them.
 */
export function useViewerWaits(options?: { readonly text?: boolean }): {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly counts: NeedsYouCounts;
} {
  const { listing } = useZeropsCandidates();
  const held = useMemo(() => heldCandidates(listing).rows, [listing]);
  const { rows } = useMenuRows(held);
  const activityOf = useMateRowActivity(useMatesActivity(options?.text !== true));
  return useWaitsOf({ candidates: rows, activityOf, releases: useWaitingReleases() });
}

/** A key typed into a field is the field's: ⌥↓ moves a caret there. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The next Mate that needs the viewer, shown in the menu — ⌥↓, or `next()`. */
export function useWaitingNext(input: {
  /** What needs the viewer (`needsYou`): each Mate it is about, in its order. */
  readonly items: ReadonlyArray<WaitingItem>;
  /** The Mate whose conversation is open: where "next" starts when nothing else is in view. */
  readonly activeProjectId: string | null;
  /** Called before a Mate is shown — a phone's menu opens first. */
  readonly beforeReveal?: (() => void) | undefined;
  readonly enabled: boolean;
}): () => void {
  const { items, activeProjectId, beforeReveal, enabled } = input;
  const next = useCallback(() => {
    const { cursor, reveal, mateOrder } = useSidebarReveal.getState();
    const waiting = [...new Set(items.flatMap((item) => waitingProjectId(item) ?? []))];
    // The whole menu's order, so a cursor on a Mate that waits on nobody
    // still says where "next" starts.
    const target = nextWaitingMate(
      mateOrder.length > 0 ? mateOrder : waiting,
      new Set(waiting),
      cursor ?? activeProjectId,
    );
    if (target === undefined) return;
    beforeReveal?.();
    reveal({ kind: "mate", projectId: target });
  }, [activeProjectId, beforeReveal, items]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key !== "ArrowDown" || typedIntoField(event.target)) return;
      event.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, next]);

  return next;
}
