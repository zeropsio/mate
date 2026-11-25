import { cva, type VariantProps } from "class-variance-authority";

import { watchIntersections } from "~/lib/restingIntersections";
import { cn } from "~/lib/utils";

// A skeleton's width and height are its content, so consumers size it through
// className (the lint contract allows layout there). Its shape is not.
const skeletonVariants = cva(
  "relative block overflow-hidden bg-muted after:absolute after:inset-0 after:animate-skeleton after:bg-linear-120/srgb after:from-transparent after:from-40% after:via-shimmer after:to-transparent after:to-60% motion-reduce:after:content-none",
  {
    variants: {
      shape: {
        block: "rounded-control",
        card: "rounded-card",
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

/**
 * A block `span`, so it can stand in a line of words (a `<p>`, a heading) as well as in a box.
 * Its sweep runs only while it is in view (`data-seen`, read by `index.css`): a page's stand-ins
 * out of sight keep their boxes and move nothing. One watcher serves every skeleton on the page.
 */
const seen = watchIntersections((entries) => {
  for (const entry of entries) entry.target.toggleAttribute("data-seen", entry.isIntersecting);
});

function sweepWhileSeen(node: HTMLSpanElement | null) {
  if (node === null) return;
  // Nowhere to ask (a test's page): it sweeps as it always did.
  if (seen === undefined) {
    node.setAttribute("data-seen", "");
    return;
  }
  seen.observe(node);
  return () => seen.unobserve(node);
}

function Skeleton({
  className,
  shape,
  surface,
  ...props
}: Omit<React.ComponentProps<"span">, "ref"> & VariantProps<typeof skeletonVariants>) {
  return (
    <span
      className={cn(skeletonVariants({ shape, surface }), className)}
      data-slot="skeleton"
      ref={sweepWhileSeen}
      {...props}
    />
  );
}

export { Skeleton };
