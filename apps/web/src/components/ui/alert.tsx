import { cva, type VariantProps } from "class-variance-authority";
import { Children, isValidElement } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const alertVariants = cva("relative rounded-xl border px-3.5 py-3 text-card-foreground text-sm", {
  defaultVariants: {
    surface: "default",
    variant: "default",
  },
  variants: {
    // "glass" floats the alert over content; alert-glass tints from data-variant.
    surface: {
      default: "",
      glass: "alert-glass",
    },
    variant: {
      default: "border-border bg-muted/35 [&_svg]:text-muted-foreground",
      error: "border-border bg-muted/35 [&_svg]:text-error",
      info: "border-info/32 bg-info/4 [&_svg]:text-info",
      success: "border-success/32 bg-success/4 [&_svg]:text-success",
      warning: "border-border bg-muted/35 [&_svg]:text-warning",
    },
  },
});

function alertChildSlot(child: React.ReactElement): string | undefined {
  const propsSlot = (child.props as Record<string, string | undefined>)["data-slot"];
  if (propsSlot) {
    return propsSlot;
  }

  const type = child.type as { displayName?: string; name?: string };
  switch (type.displayName ?? type.name) {
    case "AlertAction":
      return "alert-action";
    case "AlertTitle":
      return "alert-title";
    case "AlertDescription":
      return "alert-description";
    default:
      return undefined;
  }
}

function Alert({
  className,
  variant,
  surface,
  controlAlignment = "center",
  layout = "row",
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    controlAlignment?: "center" | "first-line";
    layout?: "row" | "centered";
  }) {
  const icon: React.ReactNode[] = [];
  const content: React.ReactNode[] = [];
  const action: React.ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      content.push(child);
      return;
    }
    const slot = alertChildSlot(child);
    if (slot === "alert-action") {
      action.push(child);
    } else if (slot === "alert-title" || slot === "alert-description") {
      content.push(child);
    } else {
      icon.push(child);
    }
  });

  return (
    <div
      className={cn(alertVariants({ surface, variant }), className)}
      data-slot="alert"
      data-variant={variant ?? "default"}
      role={variant === "error" ? "alert" : "status"}
      {...props}
    >
      <div
        className={cn(
          "flex gap-2",
          layout === "centered" &&
            "flex-col items-center gap-3 text-center [&_[data-slot=alert-action]]:flex-wrap [&_[data-slot=alert-action]]:justify-center",
          layout === "row" && (controlAlignment === "first-line" ? "items-start" : "items-center"),
          layout === "row" &&
            controlAlignment === "first-line" &&
            action.length > 0 &&
            "min-h-7 pt-1 sm:min-h-6 sm:pt-0.5",
        )}
      >
        {icon.length > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center",
              controlAlignment === "first-line"
                ? "h-lh w-4 [&>svg]:size-4"
                : "size-4 [&>svg]:size-full",
            )}
          >
            {icon}
          </div>
        )}
        {content.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</div>
        )}
        {action.length > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-center",
              layout === "centered"
                ? "w-full justify-center"
                : controlAlignment === "first-line"
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
