/**
 * The release dialog in two steps: the release, and a change it carries, read in place.
 *
 * A change row steps the dialog into that change's review — the review the change's own door
 * opens, merged, with "← Release" where it says what kind of thing it is — without closing it,
 * stacking a second dialog or leaving the page. Back, or the first Esc, returns to the release
 * scrolled where it was, the pressed row holding the focus again; the next Esc closes
 * (`ZeropsReleaseSteps.logic.ts`).
 *
 * The step slides: the change comes in over the release from the right, the release giving way
 * to the left, and back undoes it — 220 ms, strong ease-out, from wherever an interrupted slide
 * stood — while the dialog's height eases to the step's. Reduced motion cuts. The step set aside
 * stays mounted and `inert`, so the release keeps its scroll and nothing in it takes a key.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  RELEASE_STEP_START,
  releaseStep,
  type ReleaseStep,
  type ReleaseStepChange,
  type ReleaseStepEvent,
} from "./ZeropsReleaseSteps.logic";
import { useReviewEscape } from "./ZeropsReviewDialog";
import type { ReviewReleaseRow } from "./ZeropsReviewSurface";

const STEP_MS = 220;
const STEP_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

function stillMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface ReleaseSteps {
  readonly step: ReleaseStep;
  /** The change drawn: it stays while it slides away after back. */
  readonly shown: ReleaseStepChange | undefined;
  /** A release row pressed: its change, in place. */
  readonly open: (row: ReviewReleaseRow) => void;
  readonly back: () => void;
  /** Where the steps and each step are drawn, as `ZeropsReleaseSteps` lays them. */
  readonly place: {
    readonly box: (element: HTMLDivElement | null) => void;
    readonly release: (element: HTMLDivElement | null) => void;
    readonly change: (element: HTMLDivElement | null) => void;
  };
}

/** The step the release dialog stands on, and the ways between its steps. */
export function useReleaseSteps(): ReleaseSteps {
  const [step, setStep] = useState<ReleaseStep>(RELEASE_STEP_START);
  const [shown, setShown] = useState<ReleaseStepChange | undefined>(undefined);
  // What `go` reads: every step goes through it, so it is never behind the state.
  const stepRef = useRef(step);
  const box = useRef<HTMLDivElement | null>(null);
  const releasePane = useRef<HTMLDivElement | null>(null);
  const changePane = useRef<HTMLDivElement | null>(null);
  // The height the steps stood at when the step changed, to ease from.
  const heightFrom = useRef<number | undefined>(undefined);
  const easing = useRef<Animation | undefined>(undefined);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether the step came from the keys: the focus it moves shows its ring only then.
  const byKeys = useRef(false);

  const go = useCallback((event: ReleaseStepEvent): boolean => {
    const next = releaseStep(stepRef.current, event);
    if (next.closes) return false;
    if (next.state === stepRef.current) return true;
    heightFrom.current = box.current?.getBoundingClientRect().height;
    const pressed = document.activeElement;
    byKeys.current =
      event.kind === "escape" ||
      (pressed instanceof HTMLElement && pressed.matches(":focus-visible"));
    clearTimeout(leaving.current);
    if (next.state.view === "change") {
      setShown(next.state.change);
    } else if (stillMotion()) {
      setShown(undefined);
    } else {
      leaving.current = setTimeout(() => {
        if (stepRef.current.view === "release") setShown(undefined);
      }, STEP_MS + 40);
    }
    stepRef.current = next.state;
    setStep(next.state);
    return true;
  }, []);

  const back = useCallback(() => {
    go({ kind: "back" });
  }, [go]);
  const escape = useCallback(() => go({ kind: "escape" }), [go]);
  useReviewEscape(step.view === "change" ? escape : undefined);

  const open = useCallback(
    (row: ReviewReleaseRow) => {
      if (row.change === undefined) return;
      go({
        kind: "open",
        change: row.change,
        rowKey: row.key,
        releaseScroll: releasePane.current?.querySelector(".rv-body")?.scrollTop ?? 0,
      });
    },
    [go],
  );

  // The height eases from where it stood to the new step's; the focus and the scroll land.
  useLayoutEffect(() => {
    const element = box.current;
    const from = heightFrom.current;
    heightFrom.current = undefined;
    if (element === null || from === undefined) return;
    if (step.view === "release") {
      const body = releasePane.current?.querySelector<HTMLElement>(".rv-body");
      if (body !== null && body !== undefined) body.scrollTop = step.scrollTop;
      const row =
        step.returnTo === undefined
          ? null
          : releasePane.current?.querySelector<HTMLElement>(
              `[data-release-row="${CSS.escape(step.returnTo)}"]`,
            );
      row?.focus({ preventScroll: true, focusVisible: byKeys.current });
    } else {
      changePane.current
        ?.querySelector<HTMLElement>("[data-review-back]")
        ?.focus({ preventScroll: true, focusVisible: byKeys.current });
    }
    easing.current?.cancel();
    easing.current = undefined;
    if (stillMotion()) return;
    const to = element.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    easing.current = element.animate(
      [{ height: `${String(from)}px` }, { height: `${String(to)}px` }],
      { duration: STEP_MS, easing: STEP_EASE },
    );
  }, [step]);

  const [place] = useState(() => ({
    box: (element: HTMLDivElement | null) => {
      box.current = element;
    },
    release: (element: HTMLDivElement | null) => {
      releasePane.current = element;
    },
    change: (element: HTMLDivElement | null) => {
      changePane.current = element;
    },
  }));
  return { step, shown, open, back, place };
}

/** The two steps drawn: the one shown holds the room, the other stands aside, `inert`. */
export function ZeropsReleaseSteps({
  steps,
  release,
  change,
}: {
  readonly steps: ReleaseSteps;
  readonly release: ReactNode;
  /** The change `steps.shown` names, merged, with the way back. */
  readonly change: ReactNode;
}) {
  const onChange = steps.step.view === "change";
  const { shown, place } = steps;
  const { box, release: releaseAt, change: changeAt } = place;
  return (
    <div className="rv-steps" ref={box}>
      <div
        className="rv-step"
        data-at={onChange ? "before" : "here"}
        inert={onChange}
        ref={releaseAt}
      >
        {release}
      </div>
      {shown === undefined ? null : (
        <div
          className="rv-step rv-step-over"
          data-at={onChange ? "here" : "after"}
          inert={!onChange}
          key={`${shown.repository}#${String(shown.number)}`}
          ref={changeAt}
        >
          {change}
        </div>
      )}
    </div>
  );
}
