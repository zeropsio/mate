/**
 * The composer's top (C3): this Mate's change, waiting for the person's
 * review, as a section inside the composer that shares its edges and its
 * corners — the Mate's face in its needs-you pose, what waits and what the
 * change is, and Review, the one blue button on it (S3). Review opens the
 * review (R1); nothing merges from here — the merge is the review's own
 * button, where the change can be read first.
 *
 * It floated over the composer as a blue banner inset from its edges, with a
 * Merge that merged on one click. The other banners (a reconnect, a version)
 * still float over the timeline; only what waits on the person joins the
 * composer, where they act on it.
 *
 * It gives way while a question or an approval waits on the person: the Mate
 * cannot go on until that is answered, and the review would be a second ask
 * stacked on the first. It comes back once the answer is in.
 *
 * Kept out of `ChatView.tsx`, which is upstream-shaped: the conversation takes
 * the strip from here and hands it to the composer as its top.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { useMemo, type ReactNode } from "react";

import { useOpenReview, type ReviewTarget } from "../../zerops/review";
import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { MateFace } from "./primitives";

/** What waits on the person in the composer right now. */
export interface ZeropsNextStepPending {
  readonly question: boolean;
  readonly approval: boolean;
}

export interface ZeropsNextStepStripModel {
  /** `Nova is waiting for your review of #2` */
  readonly title: string;
  /** The change's own title. */
  readonly detail: string;
  readonly tint: MateTintId;
  readonly target: Extract<ReviewTarget, { kind: "change" }>;
}

/**
 * The strip for `nextStep`, or `null` where nothing waits on the person — or
 * where a question or an approval waits on them first.
 */
export function zeropsNextStepStrip(
  nextStep: ZeropsMateNextStep,
  pending: ZeropsNextStepPending,
): ZeropsNextStepStripModel | null {
  if (nextStep.kind !== "review" || pending.question || pending.approval) return null;
  return {
    title: nextStep.step.title,
    detail: nextStep.step.detail,
    tint: nextStep.tint,
    target: nextStep.target,
  };
}

export function ZeropsNextStepStrip({
  strip,
  onReview,
}: {
  readonly strip: ZeropsNextStepStripModel;
  /** Opens the review, from the button that was pressed. */
  readonly onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
}) {
  return (
    <section
      aria-label={strip.title}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 border-foreground/8 border-b pt-3 pe-3.5 pb-3 ps-4"
      data-composer-top="review"
    >
      <MateFace size="md" state="needs" tint={strip.tint} />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-line leading-4.5">{strip.title}</p>
        <p className="truncate text-muted-foreground text-line leading-4.5">{strip.detail}</p>
      </div>
      <button
        className="composer-review-button"
        onClick={(event) => {
          onReview(strip.target, event.currentTarget);
        }}
        type="button"
      >
        Review
      </button>
    </section>
  );
}

/** This conversation's composer top: the strip, or nothing. */
export function useZeropsNextStepStrip(
  threadRef: ScopedThreadRef | null,
  pending: ZeropsNextStepPending,
): ReactNode {
  const openReview = useOpenReview();
  const strip = zeropsNextStepStrip(useZeropsMateNextStep(threadRef), pending);
  // The composer is memoised: the strip keeps its identity while what it
  // says does, so a conversation's re-render never re-renders the composer.
  const title = strip?.title;
  const detail = strip?.detail;
  const tint = strip?.tint;
  const groupId = strip?.target.groupId;
  const repository = strip?.target.repository;
  const number = strip?.target.number;
  return useMemo(
    () =>
      title === undefined ||
      detail === undefined ||
      tint === undefined ||
      groupId === undefined ||
      repository === undefined ||
      number === undefined ? null : (
        <ZeropsNextStepStrip
          onReview={(target, from) => {
            openReview(target, { from });
          }}
          strip={{ title, detail, tint, target: { kind: "change", groupId, repository, number } }}
        />
      ),
    [detail, groupId, number, openReview, repository, tint, title],
  );
}
