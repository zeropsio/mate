"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "~/lib/utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  /**
   * `line`: frameless, one line tall, growing with its words up to six lines, for a composer
   * inside its own pill or box. `code`: frameless monospace that never wraps, its lines on a 20 px
   * rhythm, as tall as what it holds, for text beside a gutter that keeps that rhythm.
   */
  size?: "sm" | "default" | "lg" | "line" | "code" | number;
  unstyled?: boolean;
  /**
   * With `code`: a mark per line in a 26 px column at its start, on the text's 20 px rhythm (a
   * line's change, `+` or `~`), and the field's own frame around both, its edge firming while the
   * caret is in it: a text whose lines carry marks (a vault's values as text). One child per line.
   */
  gutter?: React.ReactNode;
};

function Textarea({ gutter, ...props }: TextareaProps) {
  if (gutter === undefined) return <TextareaControl {...props} />;
  return (
    <span
      className="relative grid w-full min-w-0 grid-cols-[26px_minmax(0,1fr)] overflow-hidden rounded-control border border-input bg-field bg-clip-ground ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px]"
      data-slot="textarea-frame"
    >
      <span
        aria-hidden="true"
        className="py-2 text-center font-mono text-caption leading-5 font-medium text-muted-foreground select-none *:block *:h-5"
        data-slot="textarea-gutter"
      >
        {gutter}
      </span>
      <TextareaControl {...props} />
    </span>
  );
}

function TextareaControl({
  className,
  size = "default",
  unstyled = false,
  ...props
}: Omit<TextareaProps, "gutter">) {
  const frameless = unstyled || size === "line" || size === "code";
  return (
    <span
      className={
        cn(
          (size === "line" || size === "code") && "flex w-full min-w-0",
          !frameless &&
            "relative inline-flex w-full rounded-control border border-input bg-field bg-clip-ground text-typed text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-control)-1px)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-field-invalid has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-edge sm:text-body",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              // Auto-grows with content up to one cap, then scrolls.
              "field-sizing-content min-h-17.5 max-h-64 w-full rounded-[inherit] px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)] outline-none max-sm:min-h-20.5",
              size === "sm" &&
                "min-h-16.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] max-sm:min-h-19.5",
              size === "lg" && "min-h-18.5 py-[calc(--spacing(2)-1px)] max-sm:min-h-21.5",
              size === "line" &&
                "max-h-33 min-h-0 resize-none overflow-y-auto bg-transparent px-0 py-1.5 text-body leading-5 text-foreground placeholder:text-muted-foreground max-sm:min-h-0 max-sm:text-typed",
              size === "code" &&
                "max-h-none min-h-0 resize-none overflow-x-auto bg-transparent py-2 ps-1 pe-2.5 font-mono text-caption leading-5 whitespace-pre text-foreground [tab-size:2] max-sm:min-h-0",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea };
