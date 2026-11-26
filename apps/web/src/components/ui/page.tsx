"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * How wide a page's column runs, by what it holds:
 * - `column` — the conversation's own width (768): a page read like one, a change's review;
 * - `page` — a page of sections (896): Settings, a project's page, a place's;
 * - `wide` — a page of tables and grids (1024): Usage, the team's cards;
 * - `full` — the window's whole width: the overview's cards and a code browser run to its edge.
 */
const pageWidths = {
  column: "max-w-3xl",
  page: "max-w-4xl",
  wide: "max-w-5xl",
  full: "max-w-none",
} as const;

/**
 * The frame every page stands in, one on every page: its column centred at its width, the same
 * gutter at its sides (16 px on a phone, 24 beside), 24 px over its first block and 48 under its
 * last, and its blocks — its header, then its sections — 48 px apart: twice and more what a
 * section's heading keeps to its rows (`Section`), so each section reads as one group.
 * `inset="rows"` is a page whose rows carry their own 12 px inset (Settings): on a phone it gives
 * them only 4 px, so their words start 16 px in, where every page's do. `belowBar` is a page right
 * under a bar of its own on a phone: it starts 8 px under it.
 */
const pageVariants = cva("mx-auto flex w-full min-w-0 flex-col gap-12 pb-12 sm:px-6", {
  defaultVariants: { width: "page", inset: "page", belowBar: false },
  variants: {
    width: pageWidths,
    inset: { page: "px-4", rows: "px-1" },
    belowBar: { true: "pt-2", false: "pt-6" },
  },
});

type PageWidth = NonNullable<VariantProps<typeof pageVariants>["width"]>;

/** The width class a bar over the page wears to line its edges up with the page's column. */
function pageWidthClass(width: PageWidth): string {
  return pageWidths[width];
}

interface PageProps extends useRender.ComponentProps<"div"> {
  readonly width?: PageWidth | undefined;
  readonly inset?: VariantProps<typeof pageVariants>["inset"];
  readonly belowBar?: boolean | undefined;
}

function Page({ className, render, width, inset, belowBar = false, ...props }: PageProps) {
  const defaultProps = {
    className: cn(pageVariants({ width, inset, belowBar }), className),
    "data-slot": "page",
    "data-width": width ?? "page",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { Page, pageWidthClass, type PageWidth };
