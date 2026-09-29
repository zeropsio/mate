/**
 * The review as a dialog over the conversation (D12): a decision deserves focus.
 *
 * It opens from the thing that was pressed — its scale grows from that point, 200 ms, a touch
 * of lift and a fade — and closes in 150 ms (R7). Esc closes it and so does a press outside it.
 * Focus lands on the one button only when that button is safe to press, and on the review
 * itself otherwise; it goes back to what opened it. ⌘↵ presses the button while it is safe.
 * Reduced motion keeps only the fade.
 *
 * Base UI's dialog does the modal work — the focus trap, Esc, the scroll lock, what is inert
 * behind it; the look is the review's own (`index.css`, "Pass 16 · review").
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";

import { gatedPortal } from "~/components/ui/portal-gate";

import { pressesPrimary, reviewOrigin } from "./ZeropsReview.logic";

const ReviewPortal = gatedPortal(DialogPrimitive.Portal);

/** The one button, as the surface marks it: whether it is safe, and whether it can be pressed. */
const PRIMARY = "[data-review-primary]";

function primaryOf(popup: HTMLElement | null): HTMLButtonElement | null {
  return popup?.querySelector<HTMLButtonElement>(PRIMARY) ?? null;
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

  // Laid out, not yet painted: the scale's origin is set before the first frame moves.
  const place = useCallback(
    (element: HTMLDivElement | null) => {
      popup.current = element;
      if (element === null) return;
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
    },
    [from],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const primary = primaryOf(popup.current);
    if (primary === null) return;
    const safe = primary.dataset.safe === "true";
    if (
      !pressesPrimary(
        { key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, repeat: event.repeat },
        { safe, enabled: !primary.disabled },
      )
    ) {
      return;
    }
    event.preventDefault();
    primary.click();
  }, []);

  return (
    <DialogPrimitive.Root
      onOpenChange={(next) => {
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
            className="rv"
            data-zerops-surface="review"
            finalFocus={() => (from?.isConnected === true ? from : true)}
            initialFocus={() => {
              const primary = primaryOf(popup.current);
              return primary !== null && primary.dataset.safe === "true" && !primary.disabled
                ? primary
                : popup.current;
            }}
            onKeyDown={onKeyDown}
            ref={place}
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </ReviewPortal>
    </DialogPrimitive.Root>
  );
}
