"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface PageHeaderProps extends Omit<useRender.ComponentProps<"header">, "title" | "children"> {
  /** What the page is, in the words that opened it. */
  readonly title: ReactNode;
  /** A mark before the title: the Mate's face, the person, the page's icon. */
  readonly lead?: ReactNode;
  /** How many things the page lists, right after its title. */
  readonly count?: number | undefined;
  /** One line under the title: what the page is for, or the fact the page is about. */
  readonly line?: ReactNode;
  /** The page's own actions, at the end of the title's line. */
  readonly actions?: ReactNode;
}

/**
 * A page's head, one piece on every page: its mark, its title with its count beside it, one line
 * under it, and the page's actions at the title line's end. Its height does not change as the
 * line or the count arrive.
 */
function PageHeader({
  className,
  render,
  title,
  lead,
  count,
  line,
  actions,
  ...props
}: PageHeaderProps) {
  const defaultProps = {
    className: cn("flex min-w-0 items-start gap-3", className),
    "data-slot": "page-header",
    children: (
      <>
        {lead === undefined || lead === null ? null : (
          <span className="flex shrink-0 items-center" data-slot="page-header-lead">
            {lead}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-h-8 min-w-0 items-center gap-2">
            <h1 className="m-0 min-w-0 truncate font-semibold text-foreground text-xl leading-7">
              {title}
            </h1>
            {count === undefined ? null : (
              <span className="shrink-0 text-muted-foreground text-sm tabular-nums">{count}</span>
            )}
          </span>
          {line === undefined || line === null ? null : (
            <span className="min-w-0 text-muted-foreground text-sm" data-slot="page-header-line">
              {line}
            </span>
          )}
        </span>
        {actions === undefined || actions === null ? null : (
          <span
            className="flex min-h-8 shrink-0 items-center gap-2"
            data-slot="page-header-actions"
          >
            {actions}
          </span>
        )}
      </>
    ),
  };
  return useRender({
    defaultTagName: "header",
    props: mergeProps<"header">(defaultProps, props),
    render,
  });
}

export { PageHeader };
export type { PageHeaderProps };
