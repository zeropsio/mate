import type { ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** A time in words, its moment in a tooltip. */
export function GitWhen({ at, children }: { readonly at: string; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipPopup>{new Date(at).toLocaleString()}</TooltipPopup>
    </Tooltip>
  );
}
