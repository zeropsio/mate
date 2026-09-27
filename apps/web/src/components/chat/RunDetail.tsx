/**
 * Where a run's detail opens: a step's command and what it printed, a
 * thought in full, a deploy's pipeline and build log, the helpers, the
 * commands a result counts. Nothing about a run opens in place any more —
 * the conversation never moves under the person to show more of it.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function RunDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  wide = false,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** A pipeline, a picture: room for more than a list. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className={cn(wide ? "sm:max-w-3xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined || description === null ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogPanel>
          <div className="min-w-0">{children}</div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
