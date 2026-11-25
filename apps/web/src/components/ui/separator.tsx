import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * A hairline between two parts that spacing alone cannot part: a card's head and its body, a
 * menu's sections, a toolbar's groups. It is drawn in the rule ink (`--color-rule`), quieter than a
 * surface's own edge, the one strength every divider in the product shares.
 *
 * - across (the default) it spans its parent's width; `orientation="vertical"` stands it upright
 *   between items on one line, as tall as the line unless its parent gives it a height (`h-4`);
 * - with words (`children`) it is a labelled rule: the words centred on the line, a rule either
 *   side, for a break in a sequence (a day in a conversation, an "or" between two ways in).
 *   `tone="info"` is a break worth seeing, such as where the unread part begins.
 *
 * Items of one list are parted by their `List`, not by a separator between each.
 */
const separatorVariants = cva(
  "shrink-0 bg-rule data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
);

const labelledVariants = cva("flex w-full min-w-0 items-center gap-3 text-caption", {
  defaultVariants: { tone: "default" },
  variants: {
    tone: {
      default: "text-muted-foreground *:data-[slot=separator-rule]:bg-rule",
      info: "font-medium text-info-foreground *:data-[slot=separator-rule]:bg-info/40",
    },
  },
});

interface SeparatorProps
  extends Omit<SeparatorPrimitive.Props, "children">, VariantProps<typeof labelledVariants> {
  /** Words on the line: a labelled rule. Its accessible name, unless `aria-label` gives another. */
  readonly children?: ReactNode;
}

function Separator({
  className,
  orientation = "horizontal",
  children,
  tone,
  ...props
}: SeparatorProps) {
  if (children === undefined || children === null || children === false) {
    return (
      <SeparatorPrimitive
        className={cn(separatorVariants(), className)}
        data-slot="separator"
        orientation={orientation}
        {...props}
      />
    );
  }
  return (
    <SeparatorPrimitive
      aria-label={typeof children === "string" ? children : undefined}
      className={cn(labelledVariants({ tone }), className)}
      data-slot="separator"
      orientation="horizontal"
      {...props}
    >
      <span aria-hidden className="h-px flex-1" data-slot="separator-rule" />
      <span className="shrink-0 tabular-nums">{children}</span>
      <span aria-hidden className="h-px flex-1" data-slot="separator-rule" />
    </SeparatorPrimitive>
  );
}

export { Separator };
