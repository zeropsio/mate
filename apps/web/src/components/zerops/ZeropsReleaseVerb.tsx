import { useCallback, useMemo } from "react";
import { flowVerbKey, flowVerbLabel } from "@t3tools/client-runtime/zerops";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import { usePutLiveRun } from "~/zerops/putLive";
import { putLiveHoldsRelease } from "~/zerops/putLive.logic";
import { REVIEW_RELEASE_LABEL, useOpenReview } from "~/zerops/review";
import { Button } from "../ui/button";

/** The release the flow offers on a group, read the way the menu row reads it. */
export function useReleaseOffer(
  groupId: string,
  flow: ZeropsProjectFlow | undefined,
): ReleaseOffer {
  const { pending } = useFlowVerbs();
  const openReview = useOpenReview();
  const onReview = useCallback(
    (from: HTMLElement) => {
      openReview({ kind: "release", groupId }, { from });
    },
    [groupId, openReview],
  );
  const gate = flow?.release.gate;
  // Production being made by Put it live is released by it, once it can take a release: no door
  // asks the person to release it meanwhile (the onboarding run's *Review release* beside
  // "Setting up production isn't finished").
  const making = putLiveHoldsRelease(usePutLiveRun(groupId));
  return {
    // A branch refused by an earlier preflight may be settled since: its review checks it again.
    offered:
      !making &&
      ((flow?.release.reviewable ?? gate?.allowed) === true ||
        flow?.release.git?.delivery?.recheck === true),
    reason: gate === undefined || gate.allowed ? undefined : gate.reason,
    releasing:
      flow?.release.inFlight !== undefined ||
      pending.has(flowVerbKey({ kind: "release", groupId })),
    tag: flow?.release.suggestion,
    onReview,
  };
}

/**
 * The door to the next release's review where the projects page draws a project's next step:
 * the same review every other door opens (R1). `label` is the step's own words.
 */
export function ZeropsReleaseVerb({
  groupId,
  label,
  offered = false,
}: {
  readonly groupId: string;
  readonly label: string;
  /**
   * The caller's flow offers the release already: the door is there from the first paint,
   * and opening the review reads what goes out.
   */
  readonly offered?: boolean;
}) {
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const release = useReleaseOffer(groupId, flows.get(groupId));
  if (!release.offered && !release.releasing && !offered) return null;
  // A card's own solid button, as a change's *Review* is beside it: one look for what waits on you.
  return (
    <Button
      data-zerops-primary-action={REVIEW_RELEASE_LABEL}
      onClick={(event) => {
        release.onReview(event.currentTarget);
      }}
    >
      {release.releasing ? flowVerbLabel("release", true) : label}
    </Button>
  );
}

/** What *Release* is offered on a page, or that it is not offered at all. */
export interface ReleaseOffer {
  /** False where the stage has nothing the production lacks, or there is no production. */
  readonly offered: boolean;
  /** A release is on its way: its review shows how far it got. */
  readonly releasing: boolean;
  /** The version it would cut, where the flow suggested one. */
  readonly tag: string | undefined;
  /** Why it is not offered, as the flow's gate says; `undefined` while it is. */
  readonly reason: string | undefined;
  /** Opens the release's review from what was pressed: nothing is tagged from a page (R1). */
  readonly onReview: (from: HTMLElement) => void;
}

/**
 * The door to the next release's review, on the page that shows what is waiting for it.
 *
 * The menu row offered *Release* and the page the row expands to did not, so the one screen
 * listing three changes merged and not live was the one screen that could not put them live.
 * Now every door to it says *Review release* and opens the same review, which carries *Release*
 * and says what it does (pass 16, R1); while one is on its way the door opens its progress.
 */
export function ReleaseAction({
  release,
  label = REVIEW_RELEASE_LABEL,
  size = "sm",
  variant,
}: {
  readonly release: ReleaseOffer;
  /** The door's words where the caller has them; *Review release* otherwise. */
  readonly label?: string;
  /** `sm` where it stands among the projects page's verbs. */
  readonly size?: "md" | "sm";
  /** `secondary` in a stop's verdict, where a verb stands beside the sentence it acts on. */
  readonly variant?: "secondary";
}) {
  if (!release.offered && !release.releasing) return null;
  return (
    <Button
      data-zerops-primary-action={REVIEW_RELEASE_LABEL}
      onClick={(event) => {
        release.onReview(event.currentTarget);
      }}
      size={size}
      {...(variant === undefined ? {} : { variant })}
    >
      {release.releasing ? flowVerbLabel("release", true) : label}
    </Button>
  );
}
