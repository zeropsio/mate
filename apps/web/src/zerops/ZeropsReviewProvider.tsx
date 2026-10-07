/**
 * Review's provider: the one door every Review word opens (R1, `review.ts`).
 *
 * Mounted once, above the menu, the conversation, the composer and the pages, so every door
 * reaches the same review: a change, the next release, a roll back, a crew task. Two doors to
 * the same thing open the same review.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ZeropsReviewDialog } from "../components/zerops/review/ZeropsReviewDialog";
import { SurfaceLoading } from "../components/SurfaceLoading";
import { ReviewContext, reviewTargetKey, type OpenReview, type ReviewTarget } from "./review";

const ZeropsChangeReview = lazy(() =>
  import("../components/zerops/review/ZeropsChangeReview").then((module) => ({
    default: module.ZeropsChangeReview,
  })),
);
const ZeropsCrewTaskReview = lazy(() =>
  import("../components/zerops/review/ZeropsCrewTaskReview").then((module) => ({
    default: module.ZeropsCrewTaskReview,
  })),
);
const ZeropsReleaseReview = lazy(() =>
  import("../components/zerops/review/ZeropsReleaseReview").then((module) => ({
    default: module.ZeropsReleaseReview,
  })),
);

interface ShownReview {
  readonly target: ReviewTarget;
  /** What opened it: the review grows from it and gives the focus back to it. */
  readonly from: HTMLElement | null;
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
        : { target, from: options?.from ?? null },
    );
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const titleId = useId();
  // The dialog stays mounted and only opens and closes: one that mounts already open is shown
  // without its entrance.
  return (
    <ReviewContext.Provider value={openReview}>
      {children}
      <ZeropsReviewDialog
        from={shown?.from ?? null}
        labelledBy={titleId}
        onClosed={() => {
          setShown(null);
        }}
        onOpenChange={setOpen}
        open={open && shown !== null}
      >
        {shown === null ? null : <ReviewBody close={close} shown={shown} titleId={titleId} />}
      </ZeropsReviewDialog>
    </ReviewContext.Provider>
  );
}

function ReviewBody({
  shown,
  titleId,
  close,
}: {
  readonly shown: ShownReview;
  readonly titleId: string;
  readonly close: () => void;
}) {
  const { target } = shown;
  const body = (() => {
    switch (target.kind) {
      case "change":
        return <ZeropsChangeReview onClose={close} target={target} titleId={titleId} />;
      case "release":
      case "rollback":
        return <ZeropsReleaseReview onClose={close} target={target} titleId={titleId} />;
      case "crew-task":
        return <ZeropsCrewTaskReview onClose={close} target={target} titleId={titleId} />;
    }
  })();
  return (
    // Keyed by what it shows, so another review starts from its own state.
    <div className="contents" key={reviewTargetKey(target)}>
      <Suspense
        fallback={
          <div className="h-96">
            <h2 id={titleId} className="sr-only">
              Review
            </h2>
            <SurfaceLoading />
          </div>
        }
      >
        {body}
      </Suspense>
    </div>
  );
}
