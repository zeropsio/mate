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
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { XIcon } from "lucide-react";

import { LeaveForGitContext } from "../gitBrowser/GitBrowserLink";
import { ZeropsReviewDialog } from "./ZeropsReviewDialog";
import { Loading } from "~/components/ui/loading";
import {
  ReviewContext,
  ReviewQueueContext,
  ReviewShownContext,
  reviewTargetKey,
  type OpenReview,
  type ReviewQueueControl,
  type ReviewTarget,
} from "~/zerops/review";
import {
  reviewQueueHolds,
  reviewQueueSide,
  reviewQueueStart,
  reviewQueueWith,
  type ReviewQueue,
} from "~/zerops/reviewQueue.logic";
import { appChunk } from "~/lib/appChunks";

/**
 * A review's code, fetched by the app's warmer once the page has settled (`appChunks.ts`), so the
 * first Review draws the review at once: fetched on the press, the dialog stood blank with only
 * its × for 0.3 s (a run 2 follow-up). A fetch that failed is fetched again on the next try; one
 * that never ran is the lazy fallback's.
 */
function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | undefined;
  let loading: Promise<ComponentType<P>> | undefined;
  const start = appChunk(
    () =>
      (loading ??= load().then(
        (component) => (loaded = component),
        (error: unknown) => {
          loading = undefined;
          throw error;
        },
      )),
  );
  const Lazy = lazy(() => start().then((component) => ({ default: component })));
  return function Preloaded(props: P) {
    // Chosen once: the lazy one that drew it keeps drawing it, so a review never mounts again.
    const [Shown] = useState(() => loaded ?? Lazy);
    return <Shown {...props} />;
  };
}

const ZeropsChangeReview = preloadable(() =>
  import("./ZeropsChangeReview").then((module) => module.ZeropsChangeReview),
);
const ZeropsCrewTaskReview = preloadable(() =>
  import("./ZeropsCrewTaskReview").then((module) => module.ZeropsCrewTaskReview),
);
const ZeropsReleaseReview = preloadable(() =>
  import("./ZeropsReleaseReview").then((module) => module.ZeropsReleaseReview),
);

interface ShownReview {
  readonly target: ReviewTarget;
  /** What opened it: the review grows from it and gives the focus back to it. */
  readonly from: HTMLElement | null;
  /** The changes reviewed together, where it was opened on several (`OpenReviewOptions.queue`). */
  readonly queue?: ReviewQueue | undefined;
}

export function ZeropsReviewProvider({ children }: { readonly children: ReactNode }) {
  const [shown, setShown] = useState<ShownReview | null>(null);
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);

  const openReview = useCallback<OpenReview>((target, options) => {
    setShown((current) => {
      const from = options?.from ?? null;
      const queue = options?.queue;
      if (queue !== undefined && queue.length > 0 && target.kind === "change") {
        return { target, from, queue: reviewQueueWith(reviewQueueStart(queue), { at: target }) };
      }
      if (current === null || !isOpen.current) return { target, from };
      if (reviewTargetKey(current.target) === reviewTargetKey(target)) return current;
      // A door inside a queued review to another queued change ("Builds on #11") steps within it.
      if (current.queue !== undefined && target.kind === "change") {
        if (reviewQueueHolds(current.queue, target)) {
          const arrived = reviewQueueSide(current.queue, target);
          return {
            ...current,
            target,
            queue: reviewQueueWith(current.queue, { at: target, arrived }),
          };
        }
      }
      return { target, from };
    });
    setOpen(true);
  }, []);

  const go = useCallback<ReviewQueueControl["go"]>((target) => {
    // Never under a sheet already closing: what it shows stays until it is gone.
    if (!isOpen.current) return;
    setShown((current) =>
      current?.queue === undefined || !reviewQueueHolds(current.queue, target)
        ? current
        : {
            ...current,
            target,
            queue: reviewQueueWith(current.queue, {
              at: target,
              arrived: reviewQueueSide(current.queue, target),
            }),
          },
    );
  }, []);
  const pressed = useCallback<ReviewQueueControl["pressed"]>((target, done) => {
    setShown((current) =>
      current?.queue === undefined || !reviewQueueHolds(current.queue, target)
        ? current
        : { ...current, queue: reviewQueueWith(current.queue, { done: { target, kind: done } }) },
    );
  }, []);
  const queue = shown?.queue;
  const queueControl = useMemo<ReviewQueueControl | null>(
    () => (queue === undefined ? null : { queue, go, pressed }),
    [go, pressed, queue],
  );

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const titleId = useId();
  // The dialog stays mounted and only opens and closes: one that mounts already open is shown
  // without its entrance.
  return (
    <ReviewContext.Provider value={openReview}>
      <ReviewShownContext.Provider value={open && shown !== null}>
        {children}
      </ReviewShownContext.Provider>
      <ZeropsReviewDialog
        from={shown?.from ?? null}
        labelledBy={titleId}
        onClosed={() => {
          setShown(null);
        }}
        onOpenChange={setOpen}
        open={open && shown !== null}
      >
        <ReviewQueueContext.Provider value={queueControl}>
          {shown === null ? null : <ReviewBody close={close} shown={shown} titleId={titleId} />}
        </ReviewQueueContext.Provider>
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
    // Keyed by what it shows, so another review starts from its own state. A link into the Git
    // browser leaves the dialog: it closes as the page goes.
    <LeaveForGitContext value={close} key={reviewTargetKey(target)}>
      <div className="contents">
        <Suspense
          fallback={
            <div className="relative h-96">
              <h2 id={titleId} className="sr-only">
                Review
              </h2>
              <div className="absolute end-2 top-2">
                <button aria-label="Close" className="rv-x" onClick={close} type="button">
                  <XIcon aria-hidden="true" />
                </button>
              </div>
              <Loading label="The review" shape="room" />
            </div>
          }
        >
          {body}
        </Suspense>
      </div>
    </LeaveForGitContext>
  );
}
