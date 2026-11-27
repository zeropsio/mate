"use client";

import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

import { CopyButton } from "./copy-button";
import { Skeleton } from "./skeleton";

/**
 * One value to copy, on a line of its own: a command to run, a path, an address to give another
 * service, a secret shown once. The value in monospace on the code ground, a control's height and
 * corner, its Copy press at the end inside the line. It is cut with an ellipsis (`truncate`, the
 * default; the whole value is still what Copy copies and what selection takes), or wraps anywhere
 * with `wrap` where the person reads all of it before running it (a command, a secret). A `null`
 * value is being read: the line keeps its room and Copy waits. A value that does not exist yet
 * (an address made on the next step) is `placeholder`: its words in the line's room, on a dashed
 * edge with no ground and no Copy, so nothing reads as copyable.
 *
 * `size="lg"` is a code the person types by hand on another page (a device sign-in's code): its
 * figures at the title step and spaced, to be read across a desk, the line as wide as the code.
 * While it is read, a code's width of shimmer holds that room.
 *
 * Its name, where it has one, stands beside or over it as the place's own label. Several lines of
 * text are a `CodeBlock`; a literal inside a sentence is `Text variant="code"`.
 */
function CopyLine({
  value,
  label,
  placeholder,
  wrap = false,
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  readonly value: string | null;
  /** What Copy copies, after "Copy": "the command", "the payload URL". */
  readonly label: string;
  /** Words in its room while there is no value yet: what makes it, and when. */
  readonly placeholder?: string;
  /** Wrap anywhere instead of cutting with an ellipsis. */
  readonly wrap?: boolean;
  /** `lg`: a code typed by hand elsewhere, at the title step. */
  readonly size?: "md" | "lg";
}) {
  if (value === null && placeholder !== undefined) {
    return (
      <div
        className={cn(
          "flex min-h-9 min-w-0 items-center rounded-control border border-border border-dashed px-3 py-2 text-caption text-muted-foreground",
          className,
        )}
        data-slot="copy-line"
        data-placeholder=""
        {...props}
      >
        {placeholder}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex min-h-9 min-w-0 items-center gap-1 rounded-control border border-border/60 bg-code ps-3 pe-1 text-code-foreground",
        size === "lg" && "w-fit",
        className,
      )}
      data-slot="copy-line"
      {...props}
    >
      <code
        className={cn(
          "min-w-0 flex-1 py-2 font-mono",
          size === "lg"
            ? "text-title leading-5 font-medium tracking-wider select-all"
            : "text-caption leading-5",
          wrap ? "wrap-anywhere" : "truncate",
        )}
        data-slot="copy-line-value"
      >
        {value === null && size === "lg" ? (
          <Skeleton className="my-0.5 h-4 w-[10ch]" surface="card" />
        ) : (
          value
        )}
      </code>
      <CopyButton label={label} value={value} />
    </div>
  );
}

export { CopyLine };
