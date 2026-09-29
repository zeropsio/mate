/**
 * Review's provider: the one door every Review word opens (R1, `review.ts`).
 *
 * Mounted once, above the menu, the conversation, the composer and the pages, so every door
 * reaches the same review: a change, the next release, a roll back, a crew task. Two doors to
 * the same thing open the same review; a review can hand over to the next one in its place —
 * a change that merged opens the release's review without closing.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ZeropsChangeReview } from "../components/zerops/review/ZeropsChangeReview";
import { ZeropsCrewTaskReview } from "../components/zerops/review/ZeropsCrewTaskReview";
import { ZeropsReleaseReview } from "../components/zerops/review/ZeropsReleaseReview";
import { ZeropsReviewDialog } from "../components/zerops/review/ZeropsReviewDialog";
import { ReviewContext, reviewTargetKey, type OpenReview, type ReviewTarget } from "./review";

interface ShownReview {
  readonly target: ReviewTarget;
  /** What opened it: the review grows from it and gives the focus back to it. */
  readonly from: HTMLElement | null;
  /** How many times it handed over to another review in place. */
  readonly swaps: number;
}

export function ZeropsReviewProvider({ children }: { readonly children: ReactNode }) {
  const [shown, setShown] = useState<ShownReview | null>(null);
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);

  const openReview = useCallback<OpenReview>((target, options) => {
    setShown((current) =>
      current !== null &&
      isOpen.current &&
      reviewTargetKey(current.target) === reviewTargetKey(target)
        ? current
        : { target, from: options?.from ?? null, swaps: 0 },
    );
    setOpen(true);
  }, []);

  const replace = useCallback((target: ReviewTarget) => {
    setShown((current) =>
      current === null ? current : { target, from: current.from, swaps: current.swaps + 1 },
    );
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <ReviewContext.Provider value={openReview}>
      {children}
      {shown === null ? null : (
        <ReviewHost
          close={close}
          onClosed={() => {
            setShown(null);
          }}
          onOpenChange={setOpen}
          open={open}
          replace={replace}
          shown={shown}
        />
      )}
    </ReviewContext.Provider>
  );
}

function ReviewHost({
  shown,
  open,
  onOpenChange,
  onClosed,
  close,
  replace,
}: {
  readonly shown: ShownReview;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onClosed: () => void;
  readonly close: () => void;
  readonly replace: (target: ReviewTarget) => void;
}) {
  const titleId = useId();
  const { target } = shown;
  const body = (() => {
    switch (target.kind) {
      case "change":
        return (
          <ZeropsChangeReview
            onClose={close}
            onReplace={replace}
            target={target}
            titleId={titleId}
          />
        );
      case "release":
      case "rollback":
        return <ZeropsReleaseReview onClose={close} target={target} titleId={titleId} />;
      case "crew-task":
        return <ZeropsCrewTaskReview onClose={close} target={target} titleId={titleId} />;
    }
  })();
  return (
    <ZeropsReviewDialog
      from={shown.from}
      labelledBy={titleId}
      onClosed={onClosed}
      onOpenChange={onOpenChange}
      open={open}
    >
      {/* Keyed by what it shows, so a review handed over starts from its own state. */}
      <div
        className={shown.swaps > 0 ? "rv-swap" : "contents"}
        key={`${reviewTargetKey(target)}:${String(shown.swaps)}`}
      >
        {body}
      </div>
    </ZeropsReviewDialog>
  );
}
