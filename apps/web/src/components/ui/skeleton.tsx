import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// A skeleton's width and height are its content, so consumers size it through
// className (the lint contract allows layout there). Its shape is not.
const skeletonVariants = cva(
  "relative overflow-hidden bg-muted [--skeleton-highlight:--alpha(var(--color-white)/64%)] after:absolute after:inset-0 after:animate-skeleton after:bg-[linear-gradient(120deg,transparent_40%,var(--skeleton-highlight),transparent_60%)] motion-reduce:after:content-none dark:[--skeleton-highlight:--alpha(var(--color-white)/4%)]",
  {
    variants: {
      shape: {
        block: "rounded-sm",
        card: "rounded-lg",
        pill: "rounded-full",
      },
      // What it stands on: the page, or a card (in dark the card is the muted tone itself, so a
      // page skeleton on it reads as nothing; `cn` lets the card's tone win).
      surface: {
        page: "",
        card: "bg-foreground/7",
      },
    },
    defaultVariants: { shape: "block", surface: "page" },
  },
);

function Skeleton({
  className,
  shape,
  surface,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      className={cn(skeletonVariants({ shape, surface }), className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
