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
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  dismissComposerReview,
  dismissedComposerReview,
} from "../../zerops/composerReviewDismissal";
import { useAskMateToFix, type FixProblem } from "../../zerops/fixRequest";
import { useHeldBehindReview } from "../../zerops/heldBehindReview";
import { useOpenReview, type ReviewTarget } from "../../zerops/review";
import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { MateFace } from "./primitives";

/** What waits on the person in the composer right now. */
export interface ZeropsNextStepPending {
  readonly question: boolean;
  readonly approval: boolean;
  /** The Mate works — a turn, or helpers it started: its change still moves under the ask. */
  readonly working: boolean;
}

/** The fix a change's review offers, offered on its line in place of its Review. */
export interface ZeropsNextStepFix {
  /** `Ask Nova to resolve it`. */
  readonly label: string;
  readonly mateProjectId: string;
  /** The branch its work is on: the conversation bound to it is the one asked. */
  readonly branch?: string | undefined;
  /** Its repository's address: of conversations bound to its branch, its own is asked. */
  readonly repositoryUrl?: string | undefined;
  readonly problem: FixProblem;
}

/** One of several changes waiting, on a line of its own with its own Review. */
export interface ZeropsNextStepLine {
  /** `apidev #1 Rebuild the API`, as the menu names it. */
  readonly label: string;
  readonly target: Extract<ReviewTarget, { kind: "change" }>;
  /** Where it does not merge as it stands: the word its row says (`Conflicts with main`). */
  readonly verdict?: string | undefined;
  /** Where its review offers a fix: that fix, in place of Review. */
  readonly fix?: ZeropsNextStepFix | undefined;
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

/**
 * What a dismissal of the strip puts away: its leading change, and where it lists several, each
 * of them and its row's word — so another change waiting beside them, or one merging again,
 * brings it back. A strip of one change is that change's (`composerReviewId`).
 */
export function composerStripKey(
  strip: Pick<ZeropsNextStepStripModel, "target" | "lines">,
): string {
  const lines = strip.lines ?? [];
  if (lines.length === 0) return composerReviewId(strip.target);
  const { groupId, repository, number } = strip.target;
  return JSON.stringify([
    groupId,
    repository,
    number,
    lines.map((line) => [line.target.repository, line.target.number, line.verdict ?? null]),
  ]);
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
  if (held || nextStep.kind === "none") return { strip: null, reserved: false };
  const strip = composerStrip(nextStep);
  return dismissed === composerStripKey(strip)
    ? { strip: null, reserved: false }
    : { strip, reserved: false };
}

function composerStrip(
  nextStep: Extract<ZeropsMateNextStep, { kind: "review" }>,
): ZeropsNextStepStripModel {
  return {
    title: nextStep.step.title,
    detail: nextStep.step.detail,
    tint: nextStep.tint ?? "slate",
    shape: nextStep.shape,
    target: nextStep.target,
    ...(nextStep.step.lines.length === 0
      ? {}
      : {
          lines: nextStep.step.lines.map((line): ZeropsNextStepLine => {
            const fix = line.verdict?.fix;
            return {
              label: line.label,
              target: {
                kind: "change",
                groupId: nextStep.target.groupId,
                repository: line.pull.repository,
                number: line.pull.number,
              },
              ...(line.verdict === undefined ? {} : { verdict: line.verdict.title }),
              ...(fix === undefined
                ? {}
                : {
                    fix: {
                      ...fix,
                      mateProjectId: line.pull.mateProjectId,
                      ...(line.pull.branch === undefined ? {} : { branch: line.pull.branch }),
                      ...(line.pull.repositoryUrl === undefined
                        ? {}
                        : { repositoryUrl: line.pull.repositoryUrl }),
                    },
                  }),
            };
          }),
        }),
    ...(nextStep.step.more === 0 ? {} : { more: nextStep.step.more }),
  };
}

export function ZeropsNextStepStrip({
  strip,
  onReview,
  onFix,
  onMore,
  onDismiss,
}: {
  readonly strip: ZeropsNextStepStripModel;
  /** Opens the review, from the button that was pressed. */
  readonly onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
  /** Hands a change that does not merge to its Mate, as its review's fix does. */
  readonly onFix?: ((fix: ZeropsNextStepFix) => void) | undefined;
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
    // A change that does not merge says its row's word, and offers its review's fix.
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
            <p className="truncate text-muted-foreground text-line leading-4.5">
              {line.label}
              {line.verdict === undefined ? null : <span> · {line.verdict}</span>}
            </p>
            <Button
              onClick={(event) => {
                if (line.fix === undefined) onReview(line.target, event.currentTarget);
                else onFix?.(line.fix);
              }}
              size="sm"
              variant="link"
            >
              {line.fix === undefined ? "Review" : line.fix.label}
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
      {/* A change's one door is its review, where it is merged: never *Put it live*, which makes
          production and is the project's to offer (the owner, 2026-10-18: "it's just merge into
          git, none says its connected to prod"). */}
      <Button
        onClick={(event) => {
          onReview(strip.target, event.currentTarget);
        }}
      >
        Review
      </Button>
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
  /** The branch of the lease this conversation is bound to: its change leads the strip. */
  boundBranch?: string,
): ReactNode {
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const dismiss = useCallback(
    (strip: ZeropsNextStepStripModel, from: HTMLElement) => {
      if (threadKey === null) return;
      foldAway(from.closest<HTMLElement>("[data-composer-top]"), () => {
        dismissComposerReview(threadKey, composerStripKey(strip));
        redraw();
      });
    },
    [threadKey],
  );
  const nextStep = useZeropsMateNextStep(threadRef, yours, boundBranch);
  const { strip, reserved } = zeropsComposerTop({
    nextStep,
    dismissed: threadKey === null ? undefined : dismissedComposerReview(threadKey),
    pending,
  });
  // The composer is memoised: the strip keeps its identity while what it
  // says does — a remembered strip HQ confirms is the same node, so the
  // answer re-renders nothing — and a conversation's re-render never
  // re-renders the composer.
  // A review open over the conversation holds the strip's room until it closes, invisible: a merge
  // pressed there never shrinks the composer under the conversation. Once it closes, the room
  // folds away.
  const behind = useHeldBehindReview(strip === null ? null : JSON.stringify(strip));
  const [heldStrip, setHeldStrip] = useState<string | null>(null);
  if (behind.held && heldStrip !== behind.value) setHeldStrip(behind.value);
  if (!behind.held && behind.value !== null && heldStrip !== null) setHeldStrip(null);
  const folding = !behind.held && behind.value === null ? heldStrip : null;
  const shown = behind.value ?? folding;
  const hidden = behind.held || folding !== null;
  const folded = useCallback(() => {
    setHeldStrip(null);
  }, []);
  return useMemo(() => {
    const drawn = () => {
      if (shown === null) return null;
      const strip = JSON.parse(shown) as ZeropsNextStepStripModel;
      const props = {
        onMore: (groupId: string) => {
          void navigate({ to: "/group/$groupId/flow", params: { groupId } });
        },
        onDismiss: (_target: ZeropsNextStepStripModel["target"], from: HTMLElement) => {
          dismiss(strip, from);
        },
        onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => {
          openReview(target, { from });
        },
        strip,
      };
      // Only a strip that offers a fix reads what asking a Mate needs: the composer never
      // re-renders for the threads and Mates it reads.
      return strip.lines?.some((line) => line.fix !== undefined) === true ? (
        <ZeropsNextStepStripWithFix {...props} />
      ) : (
        <ZeropsNextStepStrip {...props} />
      );
    };
    const top = () =>
      hidden ? (
        <HeldComposerTop folding={folding !== null} onFolded={folded}>
          {drawn()}
        </HeldComposerTop>
      ) : shown === null ? (
        // Its room is held for the viewer's own composer, which must not move when the change
        // comes; a colleague's read-along line holds none (HQ may never list that viewer the
        // changes, and the blank would stand for good).
        reserved && yours ? (
          <div aria-label="Reading review" data-composer-top="unread" className="h-[61px]" />
        ) : null
      ) : (
        drawn()
      );
    return top();
  }, [dismiss, folded, folding, hidden, navigate, openReview, reserved, shown, yours]);
}

/** The strip with a change that does not merge: its fix asks the Mate, as its review's fix does. */
function ZeropsNextStepStripWithFix(
  props: Omit<Parameters<typeof ZeropsNextStepStrip>[0], "onFix">,
) {
  const askMateToFix = useAskMateToFix();
  return (
    <ZeropsNextStepStrip
      {...props}
      onFix={(fix) => {
        askMateToFix(fix.mateProjectId, fix.problem, {
          branch: fix.branch,
          repositoryUrl: fix.repositoryUrl,
        });
      }}
    />
  );
}

/**
 * The strip held behind an open review: invisible and out of reach in its own room, then, once the
 * review closes, folded away like a dismissed strip.
 */
function HeldComposerTop({
  folding,
  onFolded,
  children,
}: {
  readonly folding: boolean;
  readonly onFolded: () => void;
  readonly children: ReactNode;
}) {
  const room = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (folding) foldAway(room.current, onFolded);
  }, [folding, onFolded]);
  return (
    <div aria-hidden="true" className="invisible" data-composer-top="held" inert ref={room}>
      {children}
    </div>
  );
}
