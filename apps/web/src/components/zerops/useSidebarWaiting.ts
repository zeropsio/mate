/**
 * What waits on the viewer — the one list every surface counts and says (`useViewerWaits`): the
 * menu's badge, its rail and its Waiting on you list, the overview's tab, a project's card and
 * page — and the way to the next one, ⌥↓ (`useWaitingNext`).
 *
 * Waiting is the one resolver's word (R5): a Mate of theirs whose face says it needs them, or
 * stopped on an error, or whose agent waits for the sign-in only they can make; and every project
 * whose release is offered (`releaseOffered`) and theirs to make (`useReleaseOnViewer`: being
 * allowed to release a colleague's project is not being asked to). It is always the viewer's: Mine / Everyone chooses
 * which Mates the menu lists, never what waits on them. The order is the menu's own
 * (`sidebarReveal.ts`'s `mateOrder`), so "the next one" is the next one down the list the viewer
 * is looking at.
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
import type { MateTintId } from "@t3tools/shared/brand";
import { useCallback, useEffect, useMemo } from "react";

import { reviewQueueOrder } from "~/zerops/reviewQueue.logic";
import { useMenuProjects } from "~/components/zerops/SidebarOverview";
import {
  releaseOffered,
  waitingItemsOf,
  waitingKindOf,
  type WaitingChange,
  type WaitingItem,
  type WaitingMate,
  type WaitingRelease,
} from "~/zerops/waiting.logic";

import { mateFaceOf, mateReviewCount, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useAppsChanges, useEveryAppId, useProjectFlows } from "~/zerops/projectFlows";
import { usePutLive } from "~/zerops/putLive";
import { nextWaitingMate, useSidebarReveal } from "~/zerops/sidebarReveal";
import { useMenuRows } from "~/zerops/useMenuRows";
import { useMateRowActivity } from "~/zerops/useMenuMateReadings";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useChangeStandingOf } from "~/zerops/useChangeStandingOf";
import { useReleaseOnViewer } from "~/zerops/useReleaseOnViewer";
import { useSignInWaits } from "~/zerops/useSignInWaits";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

/**
 * The Mates that wait on the viewer — their own, asking, with changes for review, stopped on an
 * error, or waiting for the agent sign-in only they can make — in the menu's order; one the menu
 * does not hold, last. Another's Mate waits on its owner, not here.
 */
export function waitingMatesOf<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  /** What its row reads (`useMateRowActivity`): HQ's word, or its socket's. */
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** How many of its own changes wait for the person's review (`mateReviewCount`). */
  readonly reviewCount: (candidate: T) => number;
  /** Whether a project's Mate waits on the viewer, as HQ says it (`waitsOnViewer`). */
  readonly waitsOnViewer: (projectId: string) => boolean;
  readonly tints: ReadonlyMap<string, MateTintId>;
  readonly order: ReadonlyArray<string>;
  /** Its change that waits for review, as the review opens it; absent where none is read. */
  readonly changeOf?: ((candidate: T) => WaitingChange | undefined) | undefined;
  /**
   * Its agent's sign-in, where it waits on the viewer (`useSignInWaits`): its words, as its
   * composer says them.
   */
  readonly signInOf?: ((candidate: T) => string | undefined) | undefined;
}): ReadonlyArray<WaitingMate> {
  const place = (projectId: string) => {
    const at = input.order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  return input.candidates
    .flatMap((candidate): ReadonlyArray<WaitingMate> => {
      if (!hasMate(candidate)) return [];
      const tint = input.tints.get(candidate.project.id) ?? "slate";
      const where = {
        projectId: candidate.project.id,
        name: projectNameInApp(candidate.project),
        tint,
        shape: mateShapeOf(candidate.project, tint),
        ...(candidate.environmentId === undefined
          ? {}
          : { environmentId: candidate.environmentId }),
      };
      // Nothing else of it moves before its agent is signed in: that is what waits.
      const signIn = input.signInOf?.(candidate);
      if (signIn !== undefined) return [{ ...where, face: "needs", kind: "sign-in", text: signIn }];
      const activity = input.activityOf(candidate);
      const changes = input.reviewCount(candidate);
      const reviewWaits = changes > 0;
      const mine = input.waitsOnViewer(candidate.project.id);
      // The face its row wears (`mateFaceOf`): asking, or its change waiting for your review —
      // read from HQ or its socket, as the row reads it; a word at rest asks nothing now.
      const face = mateFaceOf({
        connected: candidate.group === "connected",
        activity,
        reviewWaits,
        mine,
        // Only a face that needs you stands here, and no pose of its life gives that.
        pose: undefined,
      });
      // Stopped on an error, a Mate of the viewer's waits on them for help: its face stands still.
      const failed = mine && activity?.remembered !== true && activity?.kind === "failed";
      if (face !== "needs" && !failed) return [];
      const kind = waitingKindOf({ activityKind: activity?.kind, reviewWaits });
      const change = kind === "change" ? input.changeOf?.(candidate) : undefined;
      const text =
        kind === "failed"
          ? activity?.errorLine
          : kind === "change"
            ? change?.title
            : kind === "question"
              ? (activity?.question ?? activity?.snippet)
              : activity?.snippet;
      return [
        {
          ...where,
          face,
          kind,
          ...(text === undefined ? {} : { text }),
          ...(kind === "change" ? { changes } : {}),
          ...(activity?.threadId === undefined ? {} : { threadId: activity.threadId }),
          ...(change === undefined ? {} : { change }),
        },
      ];
    })
    .toSorted((left, right) => place(left.projectId) - place(right.projectId));
}

/**
 * What waits on the viewer among the candidates given, with every release offered: the one
 * computation (`waitingMatesOf`, `waitingItemsOf`). The app reads it through `useViewerWaits`; a
 * design harness hands its own fixtures in.
 */
export function useWaitsOf<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** Every project whose next release is offered (`releaseOffered`). */
  readonly releases: ReadonlyArray<WaitingRelease>;
}): { readonly mates: ReadonlyArray<WaitingMate>; readonly items: ReadonlyArray<WaitingItem> } {
  const { activityOf, candidates, releases } = input;
  const order = useSidebarReveal((state) => state.mateOrder);
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  // Its changes waiting for your review, read off the project flow the row reads.
  const { changes } = useAppsChanges(useEveryAppId());
  const waitsOnViewer = useWaitsOnViewer();
  const signInOf = useSignInWaits(candidates);
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
      waitingMatesOf({
        candidates,
        activityOf,
        reviewCount,
        waitsOnViewer,
        tints,
        order,
        changeOf,
        signInOf,
      }),
    [activityOf, candidates, changeOf, order, reviewCount, signInOf, tints, waitsOnViewer],
  );
  const items = useMemo(() => waitingItemsOf({ mates, releases }), [mates, releases]);
  return { mates, items };
}

/**
 * Every project of the organization whose next release is offered to the person, by the one gate:
 * what its card says is ready for production, whoever's move the release is.
 */
export function useOfferedReleases(): ReadonlyArray<WaitingRelease> {
  const projects = useMenuProjects();
  const flows = useProjectFlows("every").flows;
  const putLiveRuns = usePutLive((state) => state.runs);
  return useMemo(
    () =>
      projects.flatMap((project) => {
        const release = flows.get(project.id)?.release;
        return release !== undefined &&
          releaseOffered({
            allowed: release.gate.allowed,
            recheck: release.git?.delivery?.recheck,
            putLive: putLiveRuns.get(project.id),
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
    [flows, projects, putLiveRuns],
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
  readonly mates: ReadonlyArray<WaitingMate>;
  readonly items: ReadonlyArray<WaitingItem>;
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

/** The next Mate that waits on the viewer, shown in the menu — ⌥↓, or `next()`. */
export function useWaitingNext(input: {
  readonly mates: ReadonlyArray<WaitingMate>;
  /** The Mate whose conversation is open: where "next" starts when nothing else is in view. */
  readonly activeProjectId: string | null;
  /** Called before a Mate is shown — a phone's menu opens first. */
  readonly beforeReveal?: (() => void) | undefined;
  readonly enabled: boolean;
}): () => void {
  const { mates, activeProjectId, beforeReveal, enabled } = input;
  const next = useCallback(() => {
    const { cursor, reveal, mateOrder } = useSidebarReveal.getState();
    const waiting = mates.map((mate) => mate.projectId);
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
  }, [activeProjectId, beforeReveal, mates]);

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
