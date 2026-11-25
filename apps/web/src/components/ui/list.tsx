"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * A list whose items are parted by a hairline: a card of records, a settings list, a history,
 * one column of like things that would run together on spacing alone. The list draws the rules,
 * in the rule ink every divider shares; its items draw nothing at their edges. A hidden item
 * (`hidden`) takes its rule with it.
 *
 * - `rule="full"` (the default): each rule spans its item, so a list inside a card's padding is
 *   ruled to that padding;
 * - `rule="inset"`: each rule starts where the items' words start, past a 16 px padding, a 24 px
 *   mark and a 16 px gap (a route's stops, a plan's steps), and ends at that padding;
 * - `edges`: rules above the first item and under the last too, for a list standing between
 *   other content with no card around it.
 *
 * The list sets no layout of its own: it is a block, a flex column or a grid by its `className`.
 * Rows that light their own ground part by spacing instead (`Card size="rows"`); a rule between
 * two different parts (a card's head and its body) is a `Separator`.
 */
const listVariants = cva("min-w-0", {
  defaultVariants: { rule: "full", edges: false },
  variants: {
    rule: {
      full: "[&>:not([hidden])~:not([hidden])]:border-t [&>:not([hidden])~:not([hidden])]:border-rule",
      inset:
        "[&>:not([hidden])~:not([hidden])]:relative [&>:not([hidden])~:not([hidden])]:before:pointer-events-none [&>:not([hidden])~:not([hidden])]:before:absolute [&>:not([hidden])~:not([hidden])]:before:start-14 [&>:not([hidden])~:not([hidden])]:before:end-4 [&>:not([hidden])~:not([hidden])]:before:top-0 [&>:not([hidden])~:not([hidden])]:before:h-px [&>:not([hidden])~:not([hidden])]:before:bg-rule",
    },
    edges: {
      true: "border-y border-rule",
      false: "",
    },
  },
});

interface ListProps extends useRender.ComponentProps<"div">, VariantProps<typeof listVariants> {}

function List({ className, render, rule, edges, ...props }: ListProps) {
  const defaultProps = {
    className: cn(listVariants({ rule, edges }), className),
    "data-slot": "list",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { List };
