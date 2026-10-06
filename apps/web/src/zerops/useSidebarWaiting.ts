/**
 * The Mates that wait on the viewer, for the header's faces, and the way to
 * the next one — the header's button and ⌥↓.
 *
 * Waiting is the one resolver's word (R5): a Mate whose face says it needs
 * somebody. The order is the menu's own (`sidebarReveal.ts`'s `mateOrder`), so
 * "the next one" is the next one down the list the viewer is looking at.
 */
import {
  assignCandidateMateTints,
  hasMate,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { mateIsViewers } from "@t3tools/client-runtime/zerops/mateAccess";
import type { MateTintId } from "@t3tools/shared/brand";
import { useCallback, useEffect, useMemo } from "react";

import type { WaitingMate } from "~/components/zerops/SidebarWaitingStack";

import { mateFaceOf, mateReviewWaits, type ZeropsAgentActivity } from "./agentActivity";
import { useAppsChanges, useEveryAppId } from "./projectFlows";
import { nextWaitingMate, useSidebarReveal } from "./sidebarReveal";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * The Mates that wait on the viewer — their own, asking or with a change for review — in the
 * menu's order; one the menu does not hold, last. Another's Mate waits on its owner, not here.
 */
export function waitingMatesOf<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  /** What its row reads (`useMateRowActivity`): HQ's word, or its socket's. */
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  /** Its own change waits for the person's review (`mateReviewWaits`). */
  readonly reviewWaits: (candidate: T) => boolean;
  /** Who is looking: only their own Mates wait on them (`mateIsViewers`). */
  readonly viewer: string | undefined;
  readonly tints: ReadonlyMap<string, MateTintId>;
  readonly order: ReadonlyArray<string>;
  readonly shown: (candidate: T) => boolean;
}): ReadonlyArray<WaitingMate> {
  const place = (projectId: string) => {
    const at = input.order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  return input.candidates
    .flatMap((candidate): ReadonlyArray<WaitingMate> => {
      if (!hasMate(candidate) || !input.shown(candidate)) return [];
      // The face its row wears (`mateFaceOf`): asking, or its change waiting for your review —
      // read from HQ or its socket, as the row reads it; a word at rest asks nothing now.
      const face = mateFaceOf({
        connected: candidate.group === "connected",
        activity: input.activityOf(candidate),
        reviewWaits: input.reviewWaits(candidate),
        mine: mateIsViewers(candidate.project, input.viewer),
        // Only a face that needs you stands here, and no pose of its life gives that.
        pose: undefined,
      });
      if (face !== "needs") return [];
      const tint = input.tints.get(candidate.project.id) ?? "slate";
      return [
        {
          projectId: candidate.project.id,
          name: projectNameInApp(candidate.project),
          tint,
          shape: mateShapeOf(candidate.project, tint),
          face,
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
}): { readonly mates: ReadonlyArray<WaitingMate>; readonly next: () => void } {
  const order = useSidebarReveal((state) => state.mateOrder);
  const tints = useMemo(() => assignCandidateMateTints(input.candidates), [input.candidates]);
  const { activityOf, candidates, shown, activeProjectId, beforeReveal, enabled } = input;
  // Its change waiting for your review, read off the project flow the row reads.
  const { changes } = useAppsChanges(useEveryAppId());
  const viewer = useZeropsSessionOptional()?.user?.id;
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
  const mates = useMemo(
    () => waitingMatesOf({ candidates, activityOf, reviewWaits, viewer, tints, order, shown }),
    [activityOf, candidates, order, reviewWaits, shown, tints, viewer],
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

  return { mates, next };
}
