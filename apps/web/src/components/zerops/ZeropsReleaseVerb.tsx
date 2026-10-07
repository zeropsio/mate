import { useCallback, useMemo } from "react";
import { flowVerbKey, flowVerbLabel } from "@t3tools/client-runtime/zerops";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
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
  return {
    offered: gate?.allowed ?? false,
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
}: {
  readonly groupId: string;
  readonly label: string;
}) {
  // What a release would put live is compared while the step is drawn.
  const { flows } = useProjectFlows(
    useMemo(() => [groupId], [groupId]),
    { compare: true },
  );
  const release = useReleaseOffer(groupId, flows.get(groupId));
  // The projects page's verbs are all one height; this one is theirs.
  return <ReleaseAction label={label} release={release} size="compact" />;
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
  /** `compact` where it stands among the projects page's verbs. */
  readonly size?: "sm" | "compact";
  /** `outline` in a stop's verdict, where a verb stands beside the sentence it acts on. */
  readonly variant?: "outline";
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
