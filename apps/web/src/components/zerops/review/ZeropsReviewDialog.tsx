/**
 * The review as a sheet over the page (D12): a decision deserves focus. It stands 12 px in from
 * the window's top, right and bottom, 520 wide, a scrim over what is behind it.
 *
 * It opens from the right — a short slide and a fade, its touch of scale grown from the thing
 * that was pressed, 240 ms — and closes in 160 ms (R7). Esc closes it, and so do × and a press
 * outside it.
 * Focus lands on the review itself, never on its one button, so a stray Enter presses nothing
 * (the owner, 2026-10-05: Enter merged); ⌘↵ presses the button while it is safe. Focus goes back
 * to what opened it. Reduced motion keeps only the fade.
 *
 * A review stepped into another one in place — a release's change — takes the first Esc to step
 * back (`useReviewEscape`); the next one closes. A step set aside is `inert`: its button is never
 * the one ⌘↵ presses.
 *
 * It opens whole: a review still reading what it shows holds its entrance (`useReviewHold`) — the
 * scrim answers the press at once — and slides in once it is read, or after `REVIEW_HOLD_MS` at the
 * longest, when what is still read stands in its own shape. It painted in three pieces before: an
 * empty sheet, then a Merge that waited for the files, then the counts (a run 2 follow-up).
 *
 * Base UI's dialog does the modal work — the focus trap, Esc, the scroll lock, what is inert
 * behind it; the look is the review's own (`index.css`, "Pass 16 · review"). What is typed in
 * it stays in it: nothing the conversation behind listens for acts while the review is open.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { gatedPortal } from "~/components/ui/portal-gate";

import { isField, keyStaysInReview, pressesPrimary, reviewOrigin } from "./ZeropsReview.logic";

const ReviewPortal = gatedPortal(DialogPrimitive.Portal);

/** The one button, as the surface marks it: whether it is safe, and whether it can be pressed. */
const PRIMARY = "[data-review-primary]";

function primaryOf(popup: HTMLElement | null): HTMLButtonElement | null {
  if (popup === null) return null;
  for (const primary of popup.querySelectorAll<HTMLButtonElement>(PRIMARY)) {
    if (primary.closest("[inert]") === null) return primary;
  }
  return null;
}

/** Answers Esc before the dialog closes: `true` when it stepped back and the dialog stays. */
type ReviewEscape = () => boolean;

/** Puts an Esc answer first, until the returned call takes it away. */
type TakeEscape = (onEscape: ReviewEscape) => () => void;

const ReviewEscapeContext = createContext<TakeEscape | null>(null);

/** Takes Esc first while `onEscape` is given — a step back — and hands it back when it goes. */
export function useReviewEscape(onEscape: ReviewEscape | undefined): void {
  const take = useContext(ReviewEscapeContext);
  useEffect(() => {
    if (take === null || onEscape === undefined) return undefined;
    return take(onEscape);
  }, [onEscape, take]);
}

/** The longest a review's entrance waits for what it shows to be read. */
export const REVIEW_HOLD_MS = 600;

/** Holds the entrance until the returned call lets it go. */
type TakeHold = () => () => void;

const ReviewHoldContext = createContext<TakeHold | null>(null);

/**
 * Holds the sheet's entrance while `reading`: it slides in whole once it is not, or once
 * `REVIEW_HOLD_MS` have passed since it opened. A read that starts after the sheet showed holds
 * nothing: what is on screen never leaves it.
 */
export function useReviewHold(reading: boolean): void {
  const take = useContext(ReviewHoldContext);
  // Once shown whole, it is shown: a later read holds nothing.
  const [shown, setShown] = useState(!reading);
  if (!reading && !shown) setShown(true);
  const hold = reading && !shown;
  // Before the first paint, so the sheet never shows a frame before it is held.
  useLayoutEffect(() => {
    if (take === null || !hold) return undefined;
    return take();
  }, [hold, take]);
}

export function ZeropsReviewDialog({
  open,
  onOpenChange,
  onClosed,
  from,
  labelledBy,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Once it has finished closing: what it showed can go. */
  readonly onClosed: () => void;
  /** What was pressed to open it: it grows from there, and focus goes back to it. */
  readonly from: HTMLElement | null;
  readonly labelledBy: string;
  readonly children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement | null>(null);
  const escape = useRef<ReviewEscape | null>(null);
  const takeEscape = useCallback<TakeEscape>((onEscape) => {
    escape.current = onEscape;
    return () => {
      if (escape.current === onEscape) escape.current = null;
    };
  }, []);
  const [holds, setHolds] = useState(0);
  const takeHold = useCallback<TakeHold>(() => {
    setHolds((count) => count + 1);
    return () => {
      setHolds((count) => count - 1);
    };
  }, []);
  // Each opening may be held, for a moment at most: the openings are counted as they happen, and
  // the moment's end is kept for the opening it ended.
  const [wasOpen, setWasOpen] = useState(open);
  const [opening, setOpening] = useState(0);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }
  const [heldUntil, setHeldUntil] = useState(-1);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      setHeldUntil(opening);
    }, REVIEW_HOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [open, opening]);
  const heldLongEnough = heldUntil === opening;
  const holding = open && holds > 0 && !heldLongEnough;

  // Laid out, not yet painted: the scale's origin is set before the first frame moves.
  const place = useCallback(
    (element: HTMLDivElement | null) => {
      popup.current = element;
      if (element === null) return undefined;
      const rect = from?.isConnected === true ? from.getBoundingClientRect() : undefined;
      const origin = reviewOrigin(
        rect === undefined
          ? undefined
          : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        {
          left: element.offsetLeft,
          top: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        },
      );
      element.style.setProperty("--rv-origin-x", `${String(origin.x)}px`);
      element.style.setProperty("--rv-origin-y", `${String(origin.y)}px`);
      return () => {
        popup.current = null;
      };
    },
    [from],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // What is typed here acts on nothing behind: the conversation listens on the document.
    if (keyStaysInReview(event.key)) event.stopPropagation();
    const primary = primaryOf(popup.current);
    if (primary === null) return;
    if (
      !pressesPrimary(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          repeat: event.repeat,
          inField: isField(event.target),
        },
        { safe: primary.dataset.safe === "true", enabled: !primary.disabled },
      )
    ) {
      return;
    }
    event.preventDefault();
    primary.click();
  }, []);

  return (
    <DialogPrimitive.Root
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && escape.current?.() === true) {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed();
      }}
      open={open}
    >
      <ReviewPortal>
        <DialogPrimitive.Backdrop className="rv-backdrop" />
        <DialogPrimitive.Viewport className="rv-viewport">
          <DialogPrimitive.Popup
            aria-labelledby={labelledBy}
            // Modal, and said so: the composer behind takes letters typed outside any field
            // unless a modal dialog is open.
            aria-modal="true"
            aria-busy={holding || undefined}
            className="rv"
            // A dialog to every layer check: the panel launcher's letters stand aside for it.
            data-slot="dialog-popup"
            data-holding={holding ? "" : undefined}
            data-zerops-surface="review"
            finalFocus={() => (from?.isConnected === true ? from : true)}
            initialFocus={() => popup.current}
            onKeyDown={onKeyDown}
            ref={place}
          >
            <ReviewEscapeContext.Provider value={takeEscape}>
              <ReviewHoldContext.Provider value={takeHold}>{children}</ReviewHoldContext.Provider>
            </ReviewEscapeContext.Provider>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </ReviewPortal>
    </DialogPrimitive.Root>
  );
}
