"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface PageHeaderProps extends Omit<useRender.ComponentProps<"header">, "title" | "children"> {
  /**
   * What the page is, in the words that opened it; `undefined` while it is not read: its line is
   * held, empty.
   */
  readonly title: ReactNode;
  /**
   * The title stands in for a name not read ("Couldn't read this project's name"): quiet and
   * italic.
   */
  readonly placeholder?: boolean;
  /** Where the page sits, above its title: its breadcrumb, each step a way back. */
  readonly trail?: ReactNode;
  /** A mark before the title: the Mate's face, the person, the page's icon. */
  readonly lead?: ReactNode;
  /** How many things the page lists, right after its title. */
  readonly count?: ReactNode;
  /** What kind of thing the page is about, as a pill trailing its title. */
  readonly tag?: ReactNode;
  /**
   * The fact the page is about, beside its title (a place's state line, the list's freshness);
   * where the line is narrow it wraps under the title.
   */
  readonly summary?: ReactNode;
  /** One line under the title: what the page is for, or the fact the page is about. */
  readonly line?: ReactNode;
  /** The page's own actions, at the end of the title's line. */
  readonly actions?: ReactNode;
  /**
   * `page` heads a whole page; `panel` heads a side-panel page: a smaller title, its line kept
   * to one line, its own inset from the panel's edges.
   */
  readonly size?: "page" | "panel";
}

const given = (node: ReactNode): boolean => node !== undefined && node !== null;

/**
 * A page's head, one piece on every page: the trail above, its mark, its title with its count,
 * its tag and its summary beside it, one line under it, and the page's actions at the title
 * line's end. Its height does not change as the title, the line or the count arrive.
 */
function PageHeader({
  className,
  render,
  title,
  placeholder = false,
  trail,
  lead,
  count,
  tag,
  summary,
  line,
  actions,
  size = "page",
  ...props
}: PageHeaderProps) {
  const panel = size === "panel";
  const Title = panel ? "h2" : "h1";
  const head = (
    <span className="flex min-w-0 items-start gap-3">
      {given(lead) ? (
        <span className="flex shrink-0 items-center" data-slot="page-header-lead">
          {lead}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1",
            panel ? "min-h-7" : "min-h-8",
          )}
        >
          <Title
            className={cn(
              "m-0 min-w-0 truncate",
              panel ? "text-emphasis" : "text-title leading-7",
              placeholder
                ? "font-normal text-muted-foreground italic"
                : "font-semibold text-foreground",
            )}
          >
            {title ?? <span aria-hidden="true">{"\u00a0"}</span>}
          </Title>
          {given(count) ? (
            <span className="shrink-0 text-muted-foreground text-body tabular-nums">{count}</span>
          ) : null}
          {tag}
          {given(summary) ? (
            <span className="min-w-0 text-body" data-slot="page-header-summary">
              {summary}
            </span>
          ) : null}
        </span>
        {given(line) ? (
          <span
            className={cn("min-w-0 text-muted-foreground text-body", panel && "truncate")}
            data-slot="page-header-line"
          >
            {line}
          </span>
        ) : null}
      </span>
      {given(actions) ? (
        <span
          className={cn("flex shrink-0 items-center gap-2", panel ? "min-h-7" : "min-h-8")}
          data-slot="page-header-actions"
        >
          {actions}
        </span>
      ) : null}
    </span>
  );
  const defaultProps = {
    className: cn("flex min-w-0 flex-col gap-2.5", panel && "shrink-0 px-4 pt-3", className),
    "data-slot": "page-header",
    "data-size": size,
    children: (
      <>
        {trail}
        {head}
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
