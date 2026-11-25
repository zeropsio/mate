import { cva, type VariantProps } from "class-variance-authority";
import { Children, isValidElement } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A notice: what the person should know where it stands, what it means, and the one press that
 * acts on it. One component in every placement; `surface` says where it stands:
 *
 * - `default` — its own card in the flow.
 * - `glass` — floats over content (alert-glass tints from data-variant): the composer's opened
 *   notices.
 * - `tint` — a callout set into a surface (a review's reason, what HQ found, what waits on you): no
 *   edge of its own, its ground the variant's status colour laid thinly over whatever ground it
 *   stands on (neutral for `default`), its words in the foreground. It keeps the card's inset, so
 *   a tinted notice and a plain one hold their words in one place.
 * - `band` — laid edge to edge across the panel, popup or card it is about, in 12/16 words: the
 *   tint's ground and a rule on the side that faces the content (`edge`: `top` under it, `bottom`
 *   over it). Why an agent can't run at the top of its picker, a file shown only in part over its
 *   preview, a card's reading that failed at its foot.
 * - `bare` — no edge, fill, padding or type size of its own, for a notice set inside a surface its
 *   parent draws, such as the composer's notice drawer, or a notice line among a section's words.
 *
 * `icon` is its mark, tinted by the variant (a quiet `default` mark, the status colour otherwise).
 * Its children are its words (`AlertTitle`, `AlertDescription`, or plain words and paragraphs) and
 * at most one `AlertAction`. A failure is `Failure`, which draws an error notice with its Details.
 */
const alertVariants = cva("relative text-card-foreground", {
  compoundVariants: [
    { surface: "bare", className: "bg-transparent" },
    { surface: "tint", className: "border-transparent" },
    { surface: ["tint", "band"], variant: "default", className: "bg-foreground/5" },
    { surface: ["tint", "band"], variant: "info", className: "bg-status-busy/10" },
    { surface: ["tint", "band"], variant: "success", className: "bg-status-ok/13" },
    {
      surface: ["tint", "band"],
      variant: "warning",
      className: "bg-status-attention/13 [&_[data-slot=alert-icon]]:text-status-attention",
    },
    {
      surface: ["tint", "band"],
      variant: "error",
      className: "bg-status-failed/10 [&_[data-slot=alert-icon]]:text-status-failed",
    },
    { surface: "band", className: "border-border" },
    { surface: "band", edge: "top", className: "border-b" },
    { surface: "band", edge: "bottom", className: "border-t" },
  ],
  defaultVariants: {
    edge: "top",
    surface: "default",
    variant: "default",
  },
  variants: {
    edge: {
      top: "",
      bottom: "",
    },
    surface: {
      default: "rounded-card border px-3.5 py-3 text-body",
      glass: "alert-glass rounded-card border px-3.5 py-3 text-body",
      bare: "",
      tint: "rounded-card border px-3.5 py-3 text-body text-foreground",
      band: "px-4 py-2.5 text-caption text-foreground",
    },
    variant: {
      default: "border-border bg-muted/35 [&_[data-slot=alert-icon]]:text-muted-foreground",
      error: "border-border bg-muted/35 [&_[data-slot=alert-icon]]:text-error",
      info: "border-info/32 bg-info/4 [&_[data-slot=alert-icon]]:text-info",
      success: "border-success/32 bg-success/4 [&_[data-slot=alert-icon]]:text-success",
      warning: "border-border bg-muted/35 [&_[data-slot=alert-icon]]:text-warning",
    },
  },
});

function isAction(child: React.ReactNode): boolean {
  if (!isValidElement(child)) return false;
  if ((child.props as Record<string, unknown>)["data-slot"] === "alert-action") return true;
  const type = child.type as { displayName?: string };
  return type.displayName === "AlertAction";
}

function Alert({
  className,
  variant,
  surface,
  edge,
  icon,
  controlAlignment = "center",
  layout = "row",
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** Its mark: an icon the variant tints. */
    icon?: React.ReactNode;
    controlAlignment?: "center" | "first-line";
    layout?: "row" | "centered";
  }) {
  const content: React.ReactNode[] = [];
  const action: React.ReactNode[] = [];
  Children.forEach(children, (child) => {
    (isAction(child) ? action : content).push(child);
  });
  const band = surface === "band";
  // A band's words wrap under its mark, so its mark and action hold the first line.
  const firstLine = band || controlAlignment === "first-line";
  const hasIcon = icon !== undefined && icon !== null && icon !== false;

  return (
    <div
      className={cn(alertVariants({ edge, surface, variant }), className)}
      data-slot="alert"
      data-variant={variant ?? "default"}
      role={variant === "error" ? "alert" : "status"}
      {...props}
    >
      <div
        className={cn(
          // A tinted callout keeps the air a callout had before it: 10 to its mark, 4 under its title.
          surface === "tint" ? "flex gap-2.5" : "flex gap-2",
          layout === "centered" &&
            "flex-col items-center gap-3 text-center [&_[data-slot=alert-action]]:flex-wrap [&_[data-slot=alert-action]]:justify-center",
          layout === "row" && (firstLine ? "items-start" : "items-center"),
          layout === "row" &&
            firstLine &&
            !band &&
            action.length > 0 &&
            "min-h-7 pt-1 sm:min-h-6 sm:pt-0.5",
        )}
      >
        {hasIcon && (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center",
              band
                ? "h-lh w-3.5 [&>svg]:size-3.5"
                : firstLine
                  ? "h-lh w-4 [&>svg]:size-4"
                  : "size-4 [&>svg]:size-full",
            )}
            data-slot="alert-icon"
          >
            {icon}
          </div>
        )}
        {content.length > 0 && (
          <div
            className={cn("flex min-w-0 flex-1 flex-col", surface === "tint" ? "gap-1" : "gap-0.5")}
          >
            {content}
          </div>
        )}
        {action.length > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-center",
              layout === "centered"
                ? "w-full justify-center"
                : firstLine
                  ? "h-lh self-start"
                  : "self-center",
            )}
          >
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("font-medium", className)} data-slot="alert-title" {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2.5 text-muted-foreground", className)}
      data-slot="alert-description"
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex gap-1", className)} data-slot="alert-action" {...props} />;
}

AlertTitle.displayName = "AlertTitle";
AlertDescription.displayName = "AlertDescription";
AlertAction.displayName = "AlertAction";

export { Alert, AlertTitle, AlertDescription, AlertAction };
