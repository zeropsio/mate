"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "~/lib/utils";

function Label({ className, render, ...props }: useRender.ComponentProps<"label">) {
  const defaultProps = {
    className: cn(
      // A label is read, not typed in: the app's 14 px at every width (only a field needs 16 on a
      // phone, against the zoom).
      "inline-flex items-center gap-2 text-sm/4 font-medium text-foreground",
      className,
    ),
    "data-slot": "label",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps<"label">(defaultProps, props),
    render,
  });
}

export { Label };
