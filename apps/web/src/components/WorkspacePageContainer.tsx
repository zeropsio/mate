import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

export type WorkspacePageWidth = "column" | "readable" | "wide" | "expanded" | "full";

const WIDTH_CLASS: Record<WorkspacePageWidth, string> = {
  /** The conversation's own width: a page that is read like one. */
  column: "max-w-3xl",
  readable: "max-w-4xl",
  wide: "max-w-5xl",
  expanded: "max-w-6xl",
  /** The window's whole width: the overview's cards run to its edge. */
  full: "max-w-none",
};

/** The width class a page's bar uses to line its edges up with the content below. */
export function workspacePageWidthClass(width: WorkspacePageWidth): string {
  return WIDTH_CLASS[width];
}

/** Shared content frame for workspace pages. */
export function WorkspacePageContainer({
  width = "readable",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { readonly width?: WorkspacePageWidth }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-5 pt-6 pb-12 sm:px-6",
        WIDTH_CLASS[width],
        className,
      )}
      {...props}
    />
  );
}
