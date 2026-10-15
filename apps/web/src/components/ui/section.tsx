"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface SectionHeaderProps extends Omit<
  useRender.ComponentProps<"header">,
  "title" | "children"
> {
  readonly title: ReactNode;
  /** How many rows the section holds, said right after its title, never at the far edge. */
  readonly count?: number | undefined;
  /** The one thing the section lets the person do, at the end of the title's line. */
  readonly action?: ReactNode;
  /** Its heading's level: 2 on a page, 3 inside a sheet or a dialog whose title is the 2. */
  readonly level?: 2 | 3 | undefined;
}

/**
 * A section's heading: its title, its count beside it, and its one action at the end of the same
 * line. It hugs the rows under it (`Section`); sections stand at least twice that apart.
 */
function SectionHeader({
  className,
  render,
  title,
  count,
  action,
  level = 2,
  ...props
}: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const defaultProps = {
    className: cn("flex min-h-7 min-w-0 items-center gap-2", className),
    "data-slot": "section-header",
    children: (
      <>
        <Heading className="m-0 flex min-w-0 items-center gap-2 truncate font-semibold text-[15px] text-foreground leading-5">
          {title}
        </Heading>
        {count === undefined ? null : (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{count}</span>
        )}
        {action === undefined || action === null ? null : (
          <span className="ms-auto flex shrink-0 items-center gap-1">{action}</span>
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

interface SectionProps extends Omit<useRender.ComponentProps<"section">, "title"> {
  readonly title: ReactNode;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly level?: 2 | 3 | undefined;
}

/** A heading and the rows it names, 8 px under it: the heading is the rows' own. */
function Section({
  className,
  render,
  title,
  count,
  action,
  level,
  children,
  ...props
}: SectionProps) {
  const defaultProps = {
    className: cn("flex min-w-0 flex-col gap-2", className),
    "data-slot": "section",
    children: (
      <>
        <SectionHeader action={action} count={count} level={level} title={title} />
        {children}
      </>
    ),
  };
  return useRender({
    defaultTagName: "section",
    props: mergeProps<"section">(defaultProps, props),
    render,
  });
}

export { Section, SectionHeader };
export type { SectionHeaderProps, SectionProps };
