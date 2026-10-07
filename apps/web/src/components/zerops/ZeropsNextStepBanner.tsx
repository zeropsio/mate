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
 * Its × puts it away for that change: it folds out of the composer and stays
 * away, a reload included, until another change of the Mate's waits.
 *
 * It gives way while a question or an approval waits on the person: the Mate
 * cannot go on until that is answered, and the review would be a second ask
 * stacked on the first. It comes back once the answer is in.
 *
 * An unread HQ reserves the slot. Review text comes only from the account's source facts.
 *
 * Kept out of `ChatView.tsx`, which is upstream-shaped: the conversation takes
 * the strip from here and hands it to the composer as its top.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useCallback, useMemo, useReducer, type ReactNode } from "react";

import {
  dismissComposerReview,
  dismissedComposerReview,
} from "../../zerops/composerReviewDismissal";
import { useOpenReview, type ReviewTarget } from "../../zerops/review";
import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateFace } from "./primitives";

/** What waits on the person in the composer right now. */
export interface ZeropsNextStepPending {
  readonly question: boolean;
  readonly approval: boolean;
  /** The Mate works — a turn, or helpers it started: its change still moves under the ask. */
  readonly working: boolean;
}

/** One of several changes waiting, on a line of its own with its own Review. */
export interface ZeropsNextStepLine {
  /** `apidev #1 Rebuild the API`, as the menu names it. */
  readonly label: string;
  readonly target: Extract<ReviewTarget, { kind: "change" }>;
}

export interface ZeropsNextStepStripModel {
  /** `Nova is waiting for your review of #2`, or `of 2 changes` */
  readonly title: string;
  /** The change's own title — the newest's, where several wait. */
  readonly detail: string;
  /** Where several wait, the newest three, each with its own Review. */
  readonly lines?: ReadonlyArray<ZeropsNextStepLine> | undefined;
  /** How many more wait past the lines: "and 2 more" opens the project's page. */
  readonly more?: number | undefined;
  readonly tint: MateTintId;
  /** The shape its person picked; its tint's own when absent. */
  readonly shape?: MateShapeId | undefined;
  readonly target: Extract<ReviewTarget, { kind: "change" }>;
}

export interface ZeropsComposerTop {
  readonly strip: ZeropsNextStepStripModel | null;
  readonly reserved: boolean;
}

export function composerReviewId(target: ZeropsNextStepStripModel["target"]): string {
  return JSON.stringify([target.groupId, target.repository, target.number]);
}

/** Source projection alone supplies the strip; preferences can only dismiss its identity. */
export function zeropsComposerTop(input: {
  readonly nextStep: ZeropsMateNextStep;
  readonly dismissed?: string | undefined;
  readonly pending: ZeropsNextStepPending;
}): ZeropsComposerTop {
  const { nextStep, dismissed, pending } = input;
  const held = pending.question || pending.approval || pending.working;
  if (nextStep.kind === "unknown") return { strip: null, reserved: !held };
  if (held || nextStep.kind === "none" || dismissed === composerReviewId(nextStep.target))
    return { strip: null, reserved: false };
  return {
    reserved: false,
    strip: {
      title: nextStep.step.title,
      detail: nextStep.step.detail,
      tint: nextStep.tint ?? "slate",
      shape: nextStep.shape,
      target: nextStep.target,
      ...(nextStep.step.lines.length === 0
        ? {}
        : {
            lines: nextStep.step.lines.map((line) => ({
              label: line.label,
              target: {
                kind: "change" as const,
                groupId: nextStep.target.groupId,
                repository: line.pull.repository,
                number: line.pull.number,
              },
            })),
          }),
      ...(nextStep.step.more === 0 ? {} : { more: nextStep.step.more }),
    },
  };
}

export function ZeropsNextStepStrip({
  strip,
  onReview,
  onMore,
  onDismiss,
}: {
  readonly strip: ZeropsNextStepStripModel;
  /** Opens the review, from the button that was pressed. */
  readonly onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
  /** Opens the project's page, where every change waiting is listed. */
  readonly onMore?: ((groupId: string) => void) | undefined;
  /** Puts the strip away for this change, from the button that was pressed. */
  readonly onDismiss?: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
}) {
  const lines = strip.lines ?? [];
  if (lines.length > 0) {
    // Several waiting: the count on the face's line, then one line per change with its own
    // Review, newest first — in blue words, as the menu's change rows have it, so no line
    // stacks a second blue button. The strip grows upward from the composer's text, which stays.
    return (
      <section
        aria-label={strip.title}
        className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-foreground/8 border-b pt-3 pe-2.5 pb-2.5 ps-4"
        data-composer-top="review"
      >
        <MateFace shape={strip.shape} size="md" state="needs" tint={strip.tint} />
        <p className="truncate font-medium text-foreground text-line leading-4.5">{strip.title}</p>
        {dismissButton(strip.target, onDismiss, "-my-1 justify-self-end")}
        {lines.map((line) => (
          <div
            className="col-start-2 col-end-4 grid grid-cols-subgrid items-center"
            data-composer-top-line=""
            key={`${line.target.repository}#${String(line.target.number)}`}
          >
            <p className="truncate text-muted-foreground text-line leading-4.5">{line.label}</p>
            <button
              className="menu-textbtn outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                onReview(line.target, event.currentTarget);
              }}
              type="button"
            >
              Review
            </button>
          </div>
        ))}
        {strip.more === undefined || strip.more === 0 ? null : (
          <button
            className="col-start-2 cursor-pointer justify-self-start rounded-sm text-muted-foreground text-line leading-6 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onMore?.(strip.target.groupId);
            }}
            type="button"
          >
            and {strip.more} more
          </button>
        )}
      </section>
    );
  }
  return (
    <section
      aria-label={strip.title}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-x-3 border-foreground/8 border-b pt-3 pe-2 pb-3 ps-4"
      data-composer-top="review"
    >
      <MateFace shape={strip.shape} size="md" state="needs" tint={strip.tint} />
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
      {dismissButton(strip.target, onDismiss)}
    </section>
  );
}

/** The strip's ×, on one change or several: puts it away until another change waits. */
function dismissButton(
  target: ZeropsNextStepStripModel["target"],
  onDismiss: ((target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void) | undefined,
  className?: string,
) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Dismiss"
            className={
              className === undefined ? "composer-top-dismiss" : `composer-top-dismiss ${className}`
            }
            onClick={(event) => {
              onDismiss?.(target, event.currentTarget);
            }}
            type="button"
          >
            <XIcon aria-hidden="true" />
          </button>
        }
      />
      <TooltipPopup side="top">Hide until another change waits</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Folds the composer's top away — its height, padding and edge to nothing —
 * then `done`; at once where the person asked for less motion.
 */
function foldAway(top: HTMLElement | null, done: () => void): void {
  if (top === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  top.style.height = `${top.offsetHeight}px`;
  top.style.overflow = "hidden";
  void top.offsetHeight;
  top.style.transition =
    "height 200ms cubic-bezier(0.23, 1, 0.32, 1), padding 200ms cubic-bezier(0.23, 1, 0.32, 1), border-width 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms ease-out";
  top.style.height = "0px";
  top.style.paddingBlock = "0px";
  top.style.borderBottomWidth = "0px";
  top.style.opacity = "0";
  setTimeout(done, 200);
}

/** This conversation's composer top: the strip, or nothing. */
export function useZeropsNextStepStrip(
  threadRef: ScopedThreadRef | null,
  pending: ZeropsNextStepPending,
): ReactNode {
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const dismiss = useCallback(
    (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => {
      if (threadKey === null) return;
      foldAway(from.closest<HTMLElement>("[data-composer-top]"), () => {
        dismissComposerReview(threadKey, composerReviewId(target));
        redraw();
      });
    },
    [threadKey],
  );
  const { strip, reserved } = zeropsComposerTop({
    nextStep: useZeropsMateNextStep(threadRef),
    dismissed: threadKey === null ? undefined : dismissedComposerReview(threadKey),
    pending,
  });
  // The composer is memoised: the strip keeps its identity while what it
  // says does — a remembered strip HQ confirms is the same node, so the
  // answer re-renders nothing — and a conversation's re-render never
  // re-renders the composer.
  const shown = strip === null ? null : JSON.stringify(strip);
  return useMemo(
    () =>
      shown === null ? (
        reserved ? (
          <div aria-label="Reading review" data-composer-top="unread" className="h-[61px]" />
        ) : null
      ) : (
        <ZeropsNextStepStrip
          onMore={(groupId) => {
            void navigate({ to: "/group/$groupId/flow", params: { groupId } });
          }}
          onDismiss={dismiss}
          onReview={(target, from) => {
            openReview(target, { from });
          }}
          strip={JSON.parse(shown) as ZeropsNextStepStripModel}
        />
      ),
    [dismiss, navigate, openReview, reserved, shown],
  );
}
