/**
 * What waits on the viewer, for the menu's Waiting on you row and its list, and the way to the
 * next one — ⌥↓.
 *
 * Waiting is the one resolver's word (R5): a Mate whose face says it needs somebody, or a Mate of
 * theirs stopped on an error; and every project whose release is offered. The order is the menu's
 * own (`sidebarReveal.ts`'s `mateOrder`), so "the next one" is the next one down the list the
 * viewer is looking at.
 */
import {
  assignCandidateMateTints,
  hasMate,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateTintId } from "@t3tools/shared/brand";
import { useCallback, useEffect, useMemo } from "react";

import {
  waitingItemsOf,
  waitingKindOf,
  type WaitingChange,
  type WaitingItem,
  type WaitingMate,
  type WaitingRelease,
} from "~/components/zerops/SidebarWaiting.logic";

import { mateNextStep } from "@t3tools/client-runtime/zerops";

import { mateFaceOf, mateReviewWaits, type ZeropsAgentActivity } from "./agentActivity";
import { useAppsChanges, useEveryAppId } from "./projectFlows";
import { nextWaitingMate, useSidebarReveal } from "./sidebarReveal";
import { useWaitsOnViewer } from "./useZeropsMateOwners";

/**
 * The Mates that wait on the viewer — their own, asking, with a change for review, or stopped on
 * an error — in the menu's order; one the menu does not hold, last. Another's Mate waits on its
 * owner, not here.
 */
export function waitingMatesOf<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  /** What its row reads (`useMateRowActivity`): HQ's word, or its socket's. */
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** Its own change waits for the person's review (`mateReviewWaits`). */
  readonly reviewWaits: (candidate: T) => boolean;
  /** Whether a project's Mate waits on the viewer, as HQ says it (`waitsOnViewer`). */
  readonly waitsOnViewer: (projectId: string) => boolean;
  readonly tints: ReadonlyMap<string, MateTintId>;
  readonly order: ReadonlyArray<string>;
  readonly shown: (candidate: T) => boolean;
  /** Its change that waits for review, as the review opens it; absent where none is read. */
  readonly changeOf?: ((candidate: T) => WaitingChange | undefined) | undefined;
}): ReadonlyArray<WaitingMate> {
  const place = (projectId: string) => {
    const at = input.order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  return input.candidates
    .flatMap((candidate): ReadonlyArray<WaitingMate> => {
      if (!hasMate(candidate) || !input.shown(candidate)) return [];
      const activity = input.activityOf(candidate);
      const reviewWaits = input.reviewWaits(candidate);
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
      const tint = input.tints.get(candidate.project.id) ?? "slate";
      return [
        {
          projectId: candidate.project.id,
          name: projectNameInApp(candidate.project),
          tint,
          shape: mateShapeOf(candidate.project, tint),
          face,
          kind,
          ...(text === undefined ? {} : { text }),
          ...(candidate.environmentId === undefined
            ? {}
            : { environmentId: candidate.environmentId }),
          ...(activity?.threadId === undefined ? {} : { threadId: activity.threadId }),
          ...(change === undefined ? {} : { change }),
        },
      ];
    })
    .toSorted((left, right) => place(left.projectId) - place(right.projectId));
}

/** A key typed into a field is the field's: ⌥↓ moves a caret there. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useSidebarWaiting<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** Whether the menu shows this Mate (Mine / Everyone). */
  readonly shown: (candidate: T) => boolean;
  /** The Mate whose conversation is open: where "next" starts when nothing else is in view. */
  readonly activeProjectId: string | null;
  /** Called before a Mate is shown — a phone's menu opens first. */
  readonly beforeReveal?: (() => void) | undefined;
  readonly enabled: boolean;
  /** Every project whose next release is offered. */
  readonly releases?: ReadonlyArray<WaitingRelease> | undefined;
}): {
  readonly mates: ReadonlyArray<WaitingMate>;
  readonly items: ReadonlyArray<WaitingItem>;
  readonly next: () => void;
} {
  const order = useSidebarReveal((state) => state.mateOrder);
  const tints = useMemo(() => assignCandidateMateTints(input.candidates), [input.candidates]);
  const { activityOf, candidates, shown, activeProjectId, beforeReveal, enabled } = input;
  // Its change waiting for your review, read off the project flow the row reads.
  const { changes } = useAppsChanges(useEveryAppId());
  const waitsOnViewer = useWaitsOnViewer();
  const reviewWaits = useCallback(
    (candidate: T) => {
      const groupId = readZeropsMembership(candidate.project).groupId;
      return mateReviewWaits(
        groupId === undefined ? undefined : changes.get(groupId),
        candidate.project.id,
      );
    },
    [changes],
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
      });
      return step.kind === "review"
        ? {
            groupId,
            repository: step.pull.repository,
            number: step.pull.number,
            title: step.detail,
          }
        : undefined;
    },
    [changes],
  );
  const mates = useMemo(
    () =>
      waitingMatesOf({
        candidates,
        activityOf,
        reviewWaits,
        waitsOnViewer,
        tints,
        order,
        shown,
        changeOf,
      }),
    [activityOf, candidates, changeOf, order, reviewWaits, shown, tints, waitsOnViewer],
  );
  const releases = input.releases;
  const items = useMemo(
    () => waitingItemsOf({ mates, releases: releases ?? [] }),
    [mates, releases],
  );
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

  return { mates, items, next };
}
