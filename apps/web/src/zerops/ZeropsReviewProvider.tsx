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
  type ComponentType,
  type ReactNode,
} from "react";

import { XIcon } from "lucide-react";

import { LeaveForGitContext } from "../components/zerops/gitBrowser/GitBrowserLink";
import { ZeropsReviewDialog } from "../components/zerops/review/ZeropsReviewDialog";
import { Loading } from "../components/ui/loading";
import {
  ReviewContext,
  ReviewShownContext,
  reviewTargetKey,
  type OpenReview,
  type ReviewTarget,
} from "./review";
import { appChunk } from "../lib/appChunks";

/**
 * A review's code, fetched once the page is idle, so the first Review draws the review at once:
 * fetched on the press, the dialog stood blank with only its × for 0.3 s (a run 2 follow-up). A
 * fetch that failed is fetched again on the next try; one that never ran is the lazy fallback's.
 */
function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | undefined;
  let loading: Promise<ComponentType<P>> | undefined;
  const start = () =>
    (loading ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        loading = undefined;
        throw error;
      },
    ));
  const Lazy = lazy(() => start().then((component) => ({ default: component })));
  function Preloaded(props: P) {
    // Chosen once: the lazy one that drew it keeps drawing it, so a review never mounts again.
    const [Shown] = useState(() => loaded ?? Lazy);
    return <Shown {...props} />;
  }
  return {
    preload: () => {
      start().catch(() => undefined);
    },
    Preloaded,
  };
}

const { preload: preloadChange, Preloaded: ZeropsChangeReview } = preloadable(
  appChunk(() =>
    import("../components/zerops/review/ZeropsChangeReview").then(
      (module) => module.ZeropsChangeReview,
    ),
  ),
);
const { preload: preloadCrewTask, Preloaded: ZeropsCrewTaskReview } = preloadable(
  appChunk(() =>
    import("../components/zerops/review/ZeropsCrewTaskReview").then(
      (module) => module.ZeropsCrewTaskReview,
    ),
  ),
);
const { preload: preloadRelease, Preloaded: ZeropsReleaseReview } = preloadable(
  appChunk(() =>
    import("../components/zerops/review/ZeropsReleaseReview").then(
      (module) => module.ZeropsReleaseReview,
    ),
  ),
);

/** Fetches every review's code once the page has nothing else to do. */
function useReviewsPreloaded(): void {
  useEffect(() => {
    const preload = () => {
      preloadChange();
      preloadRelease();
      preloadCrewTask();
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(preload, 2000);
    return () => clearTimeout(timer);
  }, []);
}

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

  useReviewsPreloaded();
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
