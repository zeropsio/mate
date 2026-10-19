"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  DIALOG_BACKDROP_CLASS,
  DIALOG_BACKDROP_MEDIA_CLASS,
  DIALOG_BACKDROP_PLAIN_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  DIALOG_VIEWPORT_CLASS,
} from "~/components/ui/dialog-styles";
import { ScrollArea } from "~/components/ui/scroll-area";
import { gatedPortal } from "~/components/ui/portal-gate";
import { useHeldHeight } from "~/components/ui/useHeldHeight";

type DialogProps = Omit<DialogPrimitive.Root.Props, "open" | "onOpenChange"> &
  (
    | { open: boolean; onOpenChange: NonNullable<DialogPrimitive.Root.Props["onOpenChange"]> }
    | { open?: never; onOpenChange?: DialogPrimitive.Root.Props["onOpenChange"] }
  );

/** A controlled dialog must give dismissal back to the owner of its open state. */
function Dialog(props: DialogProps) {
  return <DialogPrimitive.Root {...props} />;
}

const DialogPortal = gatedPortal(DialogPrimitive.Portal);

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

const DIALOG_BACKDROP_TINT_CLASS = {
  blur: DIALOG_BACKDROP_CLASS,
  plain: DIALOG_BACKDROP_PLAIN_CLASS,
  media: DIALOG_BACKDROP_MEDIA_CLASS,
} as const;

function DialogBackdrop({
  className,
  tint = "blur",
  ...props
}: DialogPrimitive.Backdrop.Props & {
  /** `plain` is the tint without the blur; `media` dims the page to near black. */
  tint?: keyof typeof DIALOG_BACKDROP_TINT_CLASS;
}) {
  return (
    // Drawn even when the dialog opens from inside another popup, where Base UI leaves it out.
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(DIALOG_BACKDROP_TINT_CLASS[tint], className)}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      className={cn(DIALOG_VIEWPORT_CLASS, className)}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  keepMounted = false,
  backdrop = "blur",
  placement = "top",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
  keepMounted?: boolean;
  /** `plain` tints the app behind without blurring it, for a dialog that follows work in the background. */
  backdrop?: "blur" | "plain";
  /**
   * `top` stands it a little under the window's top; `center` in the window's middle with even
   * margins, for a form sized to what it asks.
   */
  placement?: "top" | "center";
}) {
  const held = useHeldHeight(props.ref);
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogBackdrop tint={backdrop} />
      <DialogViewport
        className={cn(
          placement === "center" && "grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] p-6",
          bottomStickOnMobile && "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12",
        )}
      >
        <DialogPrimitive.Popup
          className={cn(
            DIALOG_POPUP_CLASS,
            "row-start-2 max-h-full max-w-lg text-popover-foreground",
            bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
            className,
          )}
          data-slot="dialog-popup"
          {...props}
          ref={held}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={<Button size="icon-md" variant="ghost" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

/**
 * A picture or a video as large as the window lets it be: no card around it, the page dimmed to
 * near black behind it, the whole window its own. Esc closes it, as the media's own controls do.
 */
function DialogMediaPopup({ children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPortal>
      <DialogBackdrop tint="media" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50" data-slot="dialog-viewport">
        <DialogPrimitive.Popup
          // Modal, and said so: the composer behind takes letters typed outside any field unless
          // a modal dialog is open (`typeToFocus`).
          aria-modal="true"
          className="size-full outline-none transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]"
          data-slot="dialog-popup"
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]",
        variant === "default" && "border-t bg-muted/72 py-4",
        variant === "bare" && "py-4",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("wrap-anywhere font-semibold text-xl leading-none", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "space-y-4 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogViewport,
  DialogMediaPopup,
};
