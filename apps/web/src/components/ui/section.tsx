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
  readonly count?: ReactNode;
  /** The one thing the section lets the person do, at the end of the title's line. */
  readonly action?: ReactNode;
  /**
   * What the section is for, under its title: muted body text that wraps, 2 px under it. The
   * action stays on the title's line.
   */
  readonly line?: ReactNode;
  /** Its heading's level: 2 on a page, 3 inside a sheet or a dialog whose title is the 2. */
  readonly level?: 2 | 3 | undefined;
}

/**
 * A section's heading: its title, its count beside it, and its one action at the end of the same
 * line; with `line`, what the section is for under them. It hugs the rows under it (`Section`);
 * sections stand at least twice that apart.
 */
function SectionHeader({
  className,
  render,
  title,
  count,
  action,
  line,
  level = 2,
  ...props
}: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const lined = line !== undefined && line !== null;
  const titleLine = (
    <>
      <Heading className="m-0 flex min-w-0 items-center gap-2 truncate font-semibold text-[15px] text-foreground leading-5">
        {/* Plain words end in an ellipsis; a flex box itself only clips them. */}
        {typeof title === "string" ? <span className="min-w-0 truncate">{title}</span> : title}
      </Heading>
      {count === undefined || count === null ? null : (
        <span className="shrink-0 text-muted-foreground text-caption tabular-nums">{count}</span>
      )}
      {action === undefined || action === null ? null : (
        <span className="ms-auto flex shrink-0 items-center gap-1">{action}</span>
      )}
    </>
  );
  const defaultProps = {
    className: cn(
      // On a phone a heading reads whole: an action too wide to share its line goes under it, at
      // its end.
      lined
        ? "flex min-w-0 flex-col gap-0.5"
        : "flex min-h-7 min-w-0 items-center gap-2 max-sm:flex-wrap max-sm:gap-y-1",
      className,
    ),
    "data-slot": "section-header",
    children: lined ? (
      <>
        <span className="flex min-h-7 min-w-0 items-center gap-2">{titleLine}</span>
        <p className="m-0 min-w-0 text-pretty text-body text-muted-foreground">{line}</p>
      </>
    ) : (
      titleLine
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
  readonly count?: ReactNode;
  readonly action?: ReactNode;
  readonly line?: ReactNode;
  readonly level?: 2 | 3 | undefined;
}

/** A heading and the rows it names, 8 px under it: the heading is the rows' own. */
function Section({
  className,
  render,
  title,
  count,
  action,
  line,
  level,
  children,
  ...props
}: SectionProps) {
  const defaultProps = {
    className: cn("flex min-w-0 flex-col gap-2", className),
    "data-slot": "section",
    children: (
      <>
        <SectionHeader action={action} count={count} level={level} line={line} title={title} />
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
