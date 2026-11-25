"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * Words named by what they are, so each kind looks one way everywhere and changes in one place.
 * A variant fixes the step, the ink and the weight (regular unless it says otherwise); sentences
 * wrap without a lone last word, headings balance their lines.
 *
 * - `headline` — the one headline a card or a view leads with: an ask's title, a commit's subject,
 *   a task's name. 15/24, semibold, the page's ink.
 * - `heading` — a block's own heading inside a page, a card or a dialog: a setting group's name, a
 *   form's question, an item's name standing alone. 14/20, medium, the page's ink. A page's title
 *   is `PageHeader`; a section's heading over its rows is `SectionHeader`; a row's name is
 *   `Row`'s title.
 * - `label` — a group's or a column's name in a dense list or a popup ("Models", "Branches"):
 *   12/16, medium, muted. A menu's own group label is `MenuGroupLabel`.
 * - `description` — a sentence that explains: under a heading, in a dialog, beside a control.
 *   14/20, muted. Where a list's rows would stand it is `EmptyState size="line"`.
 * - `remark` — the conversation's quiet voice: a line it says about itself or its work ("Opening
 *   the page…", what a turn waits on). 13/20, muted.
 * - `note` — a small aside: a field's hint, a footnote, a caption under a figure. 12/16, muted.
 *   Under a base-ui `Field` it is `FieldDescription`.
 * - `meta` — a fact beside or under a name: a time, a count, a size, a version, a state's word.
 *   12/16, muted, figures in even columns.
 * - `error` — what is wrong with a value or a step, said where it went wrong. 12/16, the error ink.
 *   Under a base-ui `Field` it is `FieldError`; an action's refusal is `Failure size="line"`.
 * - `code` — a literal someone may copy: an id, a path, a command, a hash. Monospace, in the step
 *   and ink of the words around it. With `chip` it stands on its own quiet ground, a 4 px corner,
 *   at 11/16 in the ink around it: a literal set apart in a sentence (a `${NAME}` in a value, the
 *   tool to run), or an id or a level standing alone beside a name.
 *
 * `className` places it (margin, padding, gap, width, flex, alignment); `truncate` cuts it to one
 * line with an ellipsis (it needs a block or a flex item: a `p`, a `div`, or `block` in `className`). The wrap
 * is set on its style alone (`text-wrap-style`): `text-pretty` would set the whole `text-wrap` and
 * undo a `truncate` or a `whitespace-nowrap`.
 */
const textVariants = cva("", {
  variants: {
    variant: {
      headline: "text-emphasis font-semibold text-foreground [text-wrap-style:balance]",
      heading: "text-body font-medium text-foreground [text-wrap-style:balance]",
      label: "text-caption font-medium text-muted-foreground",
      description: "text-body text-muted-foreground [text-wrap-style:pretty]",
      remark: "text-line text-muted-foreground [text-wrap-style:pretty]",
      note: "text-caption text-muted-foreground [text-wrap-style:pretty]",
      meta: "text-caption text-muted-foreground tabular-nums",
      error: "text-caption text-destructive-foreground [text-wrap-style:pretty]",
      code: "font-mono",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
    chip: {
      true: "rounded-mark bg-foreground/7 px-1 py-px text-2xs",
      false: "",
    },
  },
});

type TextVariant = NonNullable<VariantProps<typeof textVariants>["variant"]>;

type TextProps = useRender.ComponentProps<"span"> & {
  /** One line, cut with an ellipsis. */
  readonly truncate?: boolean;
} & (
    | {
        readonly variant: "code";
        /** The literal on its own quiet ground: a code chip. */
        readonly chip?: boolean;
      }
    | { readonly variant: Exclude<TextVariant, "code">; readonly chip?: never }
  );

function Text({ className, variant, truncate = false, chip = false, render, ...props }: TextProps) {
  const defaultProps = {
    className: cn(textVariants({ variant, truncate, chip }), className),
    "data-slot": "text",
    "data-variant": variant,
    "data-chip": chip ? "" : undefined,
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

// The *Variants function is for components/ui modules only.
export { Text, type TextVariant };
