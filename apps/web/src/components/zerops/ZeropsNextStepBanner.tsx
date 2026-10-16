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
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useCallback, useMemo, useReducer, type ReactNode } from "react";

import {
  dismissComposerReview,
  dismissedComposerReview,
} from "../../zerops/composerReviewDismissal";
import { useOpenReview, type ReviewTarget } from "../../zerops/review";
import { usePutLive, type PutLiveAsk } from "../../zerops/putLive";
import { putLiveMergeGate, type PutLiveMergePull } from "../../zerops/putLive.logic";
import { useZeropsMate } from "../../zerops/useZeropsMates";
import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { MateFace } from "./primitives";
import { useConversationGroup, usePutLiveOffered, usePutLiveRow } from "./PutLiveTop";

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
  /** `Nova is waiting for your review`, or `… of 2 changes` */
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
  onPutLive,
  putLiveHeld,
  onMore,
  onDismiss,
}: {
  readonly strip: ZeropsNextStepStripModel;
  /** Opens the review, from the button that was pressed. */
  readonly onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
  /**
   * Where the project has no production yet and the person may add one: *Put it live* is the one
   * blue button, and Review steps back to quiet words beside it (`putLive.logic.ts`).
   */
  readonly onPutLive?: (() => void) | undefined;
  /**
   * Why *Put it live* waits where it would be offered: the review's verdict on the change (a
   * required check, HQ still judging it), said beside Review, the one button, where it moves on.
   */
  readonly putLiveHeld?: string | undefined;
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
        <MateFace shape={strip.shape} size={24} state="needs" tint={strip.tint} />
        <p className="truncate font-medium text-foreground text-line leading-4.5">{strip.title}</p>
        {dismissButton(strip.target, onDismiss, "-my-1 justify-self-end")}
        {lines.map((line) => (
          <div
            className="col-start-2 col-end-4 grid grid-cols-subgrid items-center"
            data-composer-top-line=""
            key={`${line.target.repository}#${String(line.target.number)}`}
          >
            <p className="truncate text-muted-foreground text-line leading-4.5">{line.label}</p>
            <Button
              onClick={(event) => {
                onReview(line.target, event.currentTarget);
              }}
              size="sm"
              variant="link"
            >
              Review
            </Button>
          </div>
        ))}
        {strip.more === undefined || strip.more === 0 ? null : (
          <div className="col-start-2 -ms-2.5 justify-self-start">
            <Button
              onClick={() => {
                onMore?.(strip.target.groupId);
              }}
              size="sm"
              variant="ghost"
            >
              and {strip.more} more
            </Button>
          </div>
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
      <MateFace shape={strip.shape} size={24} state="needs" tint={strip.tint} />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-line leading-4.5">{strip.title}</p>
        <p className="truncate text-muted-foreground text-line leading-4.5">{strip.detail}</p>
      </div>
      {onPutLive === undefined ? (
        <div className="flex min-w-0 items-center gap-3">
          {putLiveHeld === undefined ? null : (
            <p className="max-w-56 truncate text-muted-foreground text-line" role="status">
              {putLiveHeld}
            </p>
          )}
          <Button
            onClick={(event) => {
              onReview(strip.target, event.currentTarget);
            }}
          >
            Review
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            onClick={(event) => {
              onReview(strip.target, event.currentTarget);
            }}
            variant="ghost"
          >
            Review
          </Button>
          <Button onClick={onPutLive}>Put it live</Button>
        </div>
      )}
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
  /** Whether the Mate is the viewer's; a colleague's change waits for a review, not the viewer's. */
  yours = true,
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
  const nextStep = useZeropsMateNextStep(threadRef, yours);
  const { strip, reserved } = zeropsComposerTop({
    nextStep,
    dismissed: threadKey === null ? undefined : dismissedComposerReview(threadKey),
    pending,
  });
  // Put it live: offered on the person's own Mate's one change while the project has no
  // production, and its run drawn here once pressed, in the change's place — read in a part of its
  // own, once the conversation's project is known.
  const groupId = useConversationGroup(threadRef);
  const pull = nextStep.kind === "review" ? nextStep.step.pull : undefined;
  const single = nextStep.kind === "review" && nextStep.step.lines.length === 0;
  const change =
    pull === undefined || !single
      ? undefined
      : JSON.stringify({
          repository: pull.repository,
          number: pull.number,
          title: pull.title,
          head: pull.headSha,
          merged: false,
          description: pull.description,
        } satisfies PutLiveAsk["change"]);
  // What the review's Merge would say of it now: Put it live merges only what it would.
  const verdictPull =
    pull === undefined || !single
      ? undefined
      : JSON.stringify({
          number: pull.number,
          headSha: pull.headSha,
          pipeline: pull.pipeline,
          kind: pull.kind,
          baseBranch: pull.baseBranch,
          mergeability: pull.mergeability,
          merged: pull.merged,
          mergedAt: pull.mergedAt,
          state: pull.state,
          behind: pull.behind,
          ready: pull.ready,
        } satisfies PutLiveMergePull);
  const held = pending.question || pending.approval;
  const environmentId = threadRef?.environmentId;
  // The composer is memoised: the strip keeps its identity while what it
  // says does — a remembered strip HQ confirms is the same node, so the
  // answer re-renders nothing — and a conversation's re-render never
  // re-renders the composer.
  const shown = strip === null ? null : JSON.stringify(strip);
  return useMemo(() => {
    const top = (putLive?: PutLiveDoor) =>
      shown === null ? (
        // Its room is held for the viewer's own composer, which must not move when the change
        // comes; a colleague's read-along line holds none (HQ may never list that viewer the
        // changes, and the blank would stand for good).
        reserved && yours ? (
          <div aria-label="Reading review" data-composer-top="unread" className="h-[61px]" />
        ) : null
      ) : (
        <ZeropsNextStepStrip
          onMore={(groupId) => {
            void navigate({ to: "/group/$groupId/flow", params: { groupId } });
          }}
          onPutLive={putLive?.kind === "press" ? putLive.onPress : undefined}
          putLiveHeld={putLive?.kind === "held" ? putLive.words : undefined}
          onDismiss={dismiss}
          onReview={(target, from) => {
            openReview(target, { from });
          }}
          strip={JSON.parse(shown) as ZeropsNextStepStripModel}
        />
      );
    return groupId === undefined || environmentId === undefined ? (
      top()
    ) : (
      <PutLiveComposerTop
        change={change === undefined ? undefined : (JSON.parse(change) as PutLiveAsk["change"])}
        environmentId={environmentId}
        groupId={groupId}
        held={held}
        top={top}
        verdictPull={
          verdictPull === undefined ? undefined : (JSON.parse(verdictPull) as PutLiveMergePull)
        }
        yours={yours}
      />
    );
  }, [
    change,
    dismiss,
    environmentId,
    groupId,
    held,
    navigate,
    openReview,
    reserved,
    shown,
    verdictPull,
    yours,
  ]);
}

/**
 * The composer's top where the conversation's project is known: a *Put it live* run in the change's
 * place — giving way only to what the Mate itself waits on, a question or an approval — else the
 * strip, with *Put it live* as its one blue button while it is offered.
 */
function PutLiveComposerTop({
  groupId,
  environmentId,
  change,
  verdictPull,
  held,
  yours,
  top,
}: {
  readonly groupId: string;
  readonly environmentId: EnvironmentId;
  readonly change: PutLiveAsk["change"] | undefined;
  /** The change as its review judges it, where the strip carries one. */
  readonly verdictPull: PutLiveMergePull | undefined;
  readonly held: boolean;
  readonly yours: boolean;
  readonly top: (putLive?: PutLiveDoor) => ReactNode;
}) {
  const offered = usePutLiveOffered(yours ? groupId : undefined);
  const ask = usePutLive((state) => state.ask);
  const known = useZeropsMate(environmentId);
  const mate = known.kind === "mate" ? known.mate : undefined;
  const row = usePutLiveRow(groupId, { tint: mate?.tint ?? "slate", shape: mate?.shape });
  if (row !== null && !held) return row;
  if (!offered || change === undefined) return top();
  const gate = putLiveMergeGate({
    pull: verdictPull,
    mateName: mate?.name ?? "Its Mate",
    now: Date.now(),
  });
  return top(
    gate.kind === "held"
      ? gate
      : {
          kind: "press",
          onPress: () => {
            ask({ groupId, change });
          },
        },
  );
}

/** *Put it live* on the strip: one press, or why it waits for the review. */
type PutLiveDoor =
  | { readonly kind: "press"; readonly onPress: () => void }
  | { readonly kind: "held"; readonly words: string };
