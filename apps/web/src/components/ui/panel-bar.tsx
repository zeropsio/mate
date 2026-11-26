"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * The strip across a panel or a pane that holds its tools: a search, where the pane is (a path,
 * an address), its reload, its tabs. One row, 12 px in from the pane's edges, 8 px between its
 * parts, a rule under it parting it from what it heads.
 * - `size`: `md` (40 px) for tools, `lg` (44) for a row of tabs (`TabStrip`).
 * - `edge`: `bottom` heads a pane; `top` is the pane's foot, the rule over it; `none` where the
 *   rule would double another (a foot right under its pane's head).
 * Beside the conversation, under its side-panel page's head (`RightPanelShell` inline), the bar
 * reads as part of that head: no rule, 36 px, 12 px over what follows.
 */
const panelBarVariants = cva("flex min-w-0 shrink-0 items-center gap-2 px-3", {
  defaultVariants: { size: "md", edge: "bottom" },
  variants: {
    size: { md: "h-10", lg: "h-11" },
    edge: {
      bottom:
        "border-b border-rule in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-9 in-data-[preview-panel-mode=inline]:border-transparent",
      top: "border-t border-rule",
      none: "",
    },
  },
});

interface PanelBarProps extends useRender.ComponentProps<"div"> {
  readonly size?: VariantProps<typeof panelBarVariants>["size"];
  readonly edge?: VariantProps<typeof panelBarVariants>["edge"];
}

function PanelBar({ className, render, size, edge, ...props }: PanelBarProps) {
  const defaultProps = {
    className: cn(panelBarVariants({ size, edge }), className),
    "data-slot": "panel-bar",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { PanelBar };
