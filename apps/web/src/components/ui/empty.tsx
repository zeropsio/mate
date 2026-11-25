import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// Size sets how much room the state claims and how large its title reads:
// "compact" is a card-sized notice, "hero" fills a whole route.
const emptySizeClassName = {
  compact:
    "min-h-64 gap-4 p-6 md:p-10 [&_[data-slot=empty-media]]:mb-0 [&_[data-slot=empty-title]]:text-[1.0625rem] [&_[data-slot=empty-title]]:leading-6 [&_[data-slot=empty-description]]:text-[0.8125rem] [&_[data-slot=empty-description]]:leading-[1.125rem]",
  default: "gap-6 p-6 md:p-12",
  hero: "gap-6 p-6 md:p-12 [&_[data-slot=empty-title]]:text-title sm:[&_[data-slot=empty-title]]:text-display",
} as const;

function Empty({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: keyof typeof emptySizeClassName }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center text-balance text-center",
        emptySizeClassName[size],
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex max-w-sm flex-col items-center text-center", className)}
      data-slot="empty-header"
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "relative flex size-9 shrink-0 items-center justify-center rounded-control border bg-card bg-clip-ground text-foreground shadow-sm/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-control)-1px)] before:shadow-edge [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      className={cn("relative mb-6", className)}
      data-slot="empty-media"
      data-variant={variant}
      {...props}
    >
      {variant === "icon" && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "-translate-x-0.5 -rotate-10 pointer-events-none absolute bottom-px origin-bottom-left scale-84 shadow-none",
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "pointer-events-none absolute bottom-px origin-bottom-right translate-x-0.5 rotate-10 scale-84 shadow-none",
            )}
          />
        </>
      )}
      <div className={cn(emptyMediaVariants({ className, variant }))} {...props} />
    </div>
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("font-semibold text-title", className)} data-slot="empty-title" {...props} />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      className={cn(
        "text-muted-foreground text-body [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1 [[data-slot=empty-description]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-body",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}

/**
 * A place that holds nothing yet: its mark, one line saying what will be here, and at most one
 * action — none when the viewer has nothing to do. `row` stands where a list's rows would be;
 * `section` fills a panel or a card; `page` fills a whole route; `line` is the quiet sentence where
 * a section's few lines would stand ("Nothing released yet.", "No pushes recorded."): muted body
 * text that wraps, no box and no mark, its action after its words — beside `Loading shape="words"`
 * and `Failure size="line"`, the same place's other two states. Shown only once the source has
 * answered that there is nothing: before that the place is loading, after a refusal it failed.
 *
 * A `section` or a `page` with a `title` names the place first, as a heading: the mark, 20 px
 * under it the title (15/24 in a section, 20/28 on a page) with the line 6 px under it in 14/22,
 * at most 400 px wide, then the action 20 px under them ("Give Fen a crew", what a crew is, *Set
 * up a crew*). The action may be a short column: a line about it over its press.
 */
function EmptyState({
  mark,
  title,
  level = 2,
  children,
  action,
  size = "section",
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "children" | "title"> & {
  /** The place's own icon or the subject's face. */
  readonly mark?: React.ReactNode;
  /** The place's name over its line, as a heading: a section's or a page's only. */
  readonly title?: React.ReactNode;
  /** The title's heading level: 2 on a page or a panel, 3 inside a section that has its own. */
  readonly level?: 2 | 3;
  /** The one line: what will be here, true for this viewer. */
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly size?: "line" | "row" | "section" | "page";
}) {
  if (title !== undefined && title !== null && (size === "section" || size === "page")) {
    const Heading = level === 2 ? "h2" : "h3";
    return (
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center text-balance text-center",
          size === "page" ? "gap-6 p-6 md:p-12" : "min-h-64 gap-5 p-6 md:p-10",
          className,
        )}
        data-size={size}
        data-slot="empty"
        {...props}
      >
        {mark}
        <div className="flex max-w-100 flex-col items-center gap-1.5" data-slot="empty-header">
          <Heading
            className={cn(
              "m-0 font-semibold text-foreground",
              size === "page" ? "text-title" : "text-emphasis",
            )}
            data-slot="empty-title"
          >
            {title}
          </Heading>
          <p
            className="m-0 text-body text-muted-foreground leading-5.5"
            data-slot="empty-description"
          >
            {children}
          </p>
        </div>
        {action === undefined || action === null ? null : (
          <div className="flex flex-col items-center gap-3" data-slot="empty-content">
            {action}
          </div>
        )}
      </div>
    );
  }
  if (size === "line") {
    return (
      <span
        className={cn("block text-pretty text-body text-muted-foreground", className)}
        data-size="line"
        data-slot="empty"
        {...props}
      >
        {children}
        {action === undefined || action === null ? null : <> {action}</>}
      </span>
    );
  }
  if (size === "row") {
    return (
      <div
        className={cn(
          "flex min-h-12 min-w-0 items-center gap-3 px-2 text-muted-foreground text-body [&_svg]:size-4 [&_svg]:shrink-0",
          className,
        )}
        data-size="row"
        data-slot="empty"
        {...props}
      >
        {mark}
        <span className="min-w-0 flex-1">{children}</span>
        {action}
      </div>
    );
  }
  return (
    <Empty className={className} size={size === "page" ? "default" : "compact"} {...props}>
      {mark === undefined || mark === null ? null : <EmptyMedia>{mark}</EmptyMedia>}
      <EmptyDescription>{children}</EmptyDescription>
      {action === undefined || action === null ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia, EmptyState };
