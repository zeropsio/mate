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
 * A reload paints the strip the conversation showed last
 * (`composerTopMemory.ts`), and Gitea's answer, seconds later, confirms it,
 * changes its words or takes it away: the composer grew 61 px under a
 * conversation pinned to its end when the strip only arrived with the answer.
 *
 * Kept out of `ChatView.tsx`, which is upstream-shaped: the conversation takes
 * the strip from here and hands it to the composer as its top.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";

import {
  rememberComposerTop,
  rememberedComposerTop,
  type RememberedComposerTop,
} from "../../zerops/composerTopMemory";
import { useOpenReview, type ReviewTarget } from "../../zerops/review";
import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { MateFace } from "./primitives";

/** What waits on the person in the composer right now. */
export interface ZeropsNextStepPending {
  readonly question: boolean;
  readonly approval: boolean;
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

/** What the composer's top shows, and what its conversation remembers of it. */
export interface ZeropsComposerTop {
  readonly strip: ZeropsNextStepStripModel | null;
  /**
   * What the conversation remembers after this answer: the strip as shown,
   * nothing (`null`) once nothing waits, or — Gitea not having answered —
   * whatever it remembered (`undefined`).
   */
  readonly remember: RememberedComposerTop | null | undefined;
}

function stripOf(top: RememberedComposerTop): ZeropsNextStepStripModel {
  return {
    title: top.words,
    detail: top.title,
    tint: top.tint,
    shape: top.shape,
    target: {
      kind: "change",
      groupId: top.groupId,
      repository: top.repository,
      number: top.number,
    },
    ...(top.lines === undefined
      ? {}
      : {
          lines: top.lines.map((line) => ({
            label: line.label,
            target: {
              kind: "change" as const,
              groupId: top.groupId,
              repository: line.repository,
              number: line.number,
            },
          })),
        }),
    ...(top.more === undefined ? {} : { more: top.more }),
  };
}

/**
 * The composer's top for `nextStep`: Gitea's answer once it has given one,
 * and until then what this conversation showed last — so a reload paints the
 * strip it will keep. Nothing while a question or an approval waits on the
 * person first.
 */
export function zeropsComposerTop(input: {
  readonly nextStep: ZeropsMateNextStep;
  /** What this conversation's top showed last (`composerTopMemory.ts`). */
  readonly remembered: RememberedComposerTop | undefined;
  readonly pending: ZeropsNextStepPending;
}): ZeropsComposerTop {
  const { nextStep, remembered, pending } = input;
  const held = pending.question || pending.approval;
  switch (nextStep.kind) {
    case "unknown":
      return {
        strip: held || remembered === undefined ? null : stripOf(remembered),
        remember: undefined,
      };
    case "none":
      return { strip: null, remember: null };
    case "review": {
      // The face keeps the tint and the shape it was painted in until the Mate is known.
      const shape = nextStep.tint === undefined ? remembered?.shape : nextStep.shape;
      const shown: RememberedComposerTop = {
        groupId: nextStep.target.groupId,
        repository: nextStep.target.repository,
        number: nextStep.target.number,
        title: nextStep.step.detail,
        words: nextStep.step.title,
        tint: nextStep.tint ?? remembered?.tint ?? "slate",
        ...(shape === undefined ? {} : { shape }),
        ...(nextStep.step.lines.length === 0
          ? {}
          : {
              lines: nextStep.step.lines.map((line) => ({
                repository: line.pull.repository,
                number: line.pull.number,
                label: line.label,
              })),
            }),
        ...(nextStep.step.more === 0 ? {} : { more: nextStep.step.more }),
      };
      return { strip: held ? null : stripOf(shown), remember: shown };
    }
  }
}

export function ZeropsNextStepStrip({
  strip,
  onReview,
  onMore,
}: {
  readonly strip: ZeropsNextStepStripModel;
  /** Opens the review, from the button that was pressed. */
  readonly onReview: (target: ZeropsNextStepStripModel["target"], from: HTMLElement) => void;
  /** Opens the project's page, where every change waiting is listed. */
  readonly onMore?: ((groupId: string) => void) | undefined;
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
        <p className="col-span-2 truncate font-medium text-foreground text-line leading-4.5">
          {strip.title}
        </p>
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
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 border-foreground/8 border-b pt-3 pe-3.5 pb-3 ps-4"
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
    </section>
  );
}

/** This conversation's composer top: the strip, or nothing. */
export function useZeropsNextStepStrip(
  threadRef: ScopedThreadRef | null,
  pending: ZeropsNextStepPending,
): ReactNode {
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const { strip, remember } = zeropsComposerTop({
    nextStep: useZeropsMateNextStep(threadRef),
    remembered: threadKey === null ? undefined : rememberedComposerTop(threadKey),
    pending,
  });
  // Gitea's answer is what the next reload paints first.
  useEffect(() => {
    if (threadKey === null || remember === undefined) return;
    rememberComposerTop(threadKey, remember);
  }, [remember, threadKey]);
  // The composer is memoised: the strip keeps its identity while what it
  // says does — a remembered strip Gitea confirms is the same node, so the
  // answer re-renders nothing — and a conversation's re-render never
  // re-renders the composer.
  const shown = strip === null ? null : JSON.stringify(strip);
  return useMemo(
    () =>
      shown === null ? null : (
        <ZeropsNextStepStrip
          onMore={(groupId) => {
            void navigate({ to: "/group/$groupId/flow", params: { groupId } });
          }}
          onReview={(target, from) => {
            openReview(target, { from });
          }}
          strip={JSON.parse(shown) as ZeropsNextStepStripModel}
        />
      ),
    [navigate, openReview, shown],
  );
}
