"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { CollapsibleTrigger } from "./collapsible";

interface SectionHeaderProps extends Omit<
  useRender.ComponentProps<"header">,
  "title" | "children"
> {
  readonly title: ReactNode;
  /**
   * How many rows the section holds, or a short fact about them ("v0.1.3, released 7d ago"), said
   * right after its title, never at the far edge.
   */
  readonly count?: ReactNode;
  /** The one thing the section lets the person do, or its own state, at the end of the title's line. */
  readonly action?: ReactNode;
  /**
   * On a phone the action takes a line of its own under the title, its parts 8 px apart: an
   * action wider than a phone's title line leaves (a search beside its button).
   */
  readonly actionWraps?: boolean | undefined;
  /**
   * What the section is for, under its title: muted body text that wraps, 2 px under it. The
   * action stays on the title's line.
   */
  readonly line?: ReactNode;
  /** Its heading's level: 2 on a page, 3 inside a sheet or a dialog whose title is the 2. */
  readonly level?: 2 | 3 | undefined;
  /**
   * `page` heads a page's section, in the foreground; `panel` is the quiet label over a group
   * inside a surface (a card, a side panel, the menu, a sheet's parts): 14 px, medium, muted, its
   * count after " · ".
   */
  readonly size?: "page" | "panel" | undefined;
  /**
   * The heading opens and shuts the `Collapsible` it stands in: its words and count are the
   * press, a chevron at the line's end turns as it opens; the action stays its own press.
   */
  readonly folds?: boolean | undefined;
}

/**
 * A section's heading: its title, its count beside it, and its one action at the end of the same
 * line; with `line`, what the section is for under them. It hugs the rows under it (`Section`);
 * sections stand at least twice that apart. Its `id` names its heading, for the section's
 * `aria-labelledby`.
 */
function SectionHeader({
  className,
  render,
  id,
  title,
  count,
  action,
  actionWraps = false,
  line,
  level = 2,
  size = "page",
  folds = false,
  ...props
}: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const panel = size === "panel";
  const lined = line !== undefined && line !== null;
  const counted = count !== undefined && count !== null;
  // Plain words end in an ellipsis; a flex box itself only clips them.
  const words =
    typeof title === "string" ? <span className="min-w-0 truncate">{title}</span> : title;
  // The quiet label says its count in its own line of words, after " · ".
  const said = panel ? (
    <>
      {title}
      {counted ? (
        <span className="font-normal text-muted-foreground/75 tabular-nums">
          {" · "}
          {count}
        </span>
      ) : null}
    </>
  ) : (
    words
  );
  const heading = folds ? (
    <Heading
      className={cn(
        "m-0 flex min-w-0 flex-1",
        panel
          ? "text-body font-medium text-muted-foreground"
          : "text-[15px] font-semibold text-foreground leading-5",
      )}
      id={id}
    >
      <CollapsibleTrigger className="group/fold flex h-7 w-full min-w-0 items-center gap-2.5 rounded-mark text-start outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0">
        <span className="min-w-0 truncate">{said}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="ms-auto size-3.5 shrink-0 transition-transform duration-200 ease-out-strong group-aria-expanded/fold:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
    </Heading>
  ) : (
    <Heading
      className={
        panel
          ? "m-0 min-w-0 truncate text-body font-medium text-muted-foreground"
          : "m-0 flex min-w-0 items-center gap-2 truncate font-semibold text-[15px] text-foreground leading-5"
      }
      id={id}
    >
      {said}
    </Heading>
  );
  const titleLine = (
    <>
      {heading}
      {panel || !counted ? null : (
        <span className="shrink-0 text-muted-foreground text-caption tabular-nums">{count}</span>
      )}
      {action === undefined || action === null ? null : (
        <span
          className={cn(
            "ms-auto flex shrink-0 items-center",
            panel ? "text-body" : "gap-1",
            actionWraps && "max-sm:basis-full max-sm:gap-2",
          )}
        >
          {action}
        </span>
      )}
    </>
  );
  const defaultProps = {
    className: cn(
      // On a phone a heading reads whole: an action too wide to share its line goes under it, at
      // its end.
      lined
        ? "flex min-w-0 flex-col gap-0.5"
        : cn(
            "flex min-h-7 min-w-0 items-center max-sm:flex-wrap max-sm:gap-y-1",
            panel ? "gap-1.5" : "gap-2",
          ),
      actionWraps && !lined && "max-sm:gap-y-3",
      className,
    ),
    "data-slot": "section-header",
    "data-size": size,
    children: lined ? (
      <>
        <span className={cn("flex min-h-7 min-w-0 items-center", panel ? "gap-1.5" : "gap-2")}>
          {titleLine}
        </span>
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
  readonly actionWraps?: boolean | undefined;
  readonly line?: ReactNode;
  readonly level?: 2 | 3 | undefined;
  readonly size?: "page" | "panel" | undefined;
}

/** A heading and the rows it names, 8 px under it: the heading is the rows' own. */
function Section({
  className,
  render,
  title,
  count,
  action,
  actionWraps,
  line,
  level,
  size,
  children,
  ...props
}: SectionProps) {
  const defaultProps = {
    className: cn("flex min-w-0 flex-col gap-2", className),
    "data-slot": "section",
    children: (
      <>
        <SectionHeader
          action={action}
          actionWraps={actionWraps}
          count={count}
          level={level}
          line={line}
          size={size}
          title={title}
        />
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
