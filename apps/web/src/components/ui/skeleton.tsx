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
      // A stand-in that holds a place without saying it is on its way: no sweep. For a slot whose
      // value may never come (a card's target before its input names it) or a held line that
      // must not move while the rest of its surface waits.
      still: {
        true: "after:content-none",
        false: "",
      },
    },
    defaultVariants: { shape: "block", surface: "page", still: false },
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
  still,
  ...props
}: Omit<React.ComponentProps<"span">, "ref"> & VariantProps<typeof skeletonVariants>) {
  return (
    <span
      className={cn(skeletonVariants({ shape, still, surface }), className)}
      data-slot="skeleton"
      ref={still === true ? undefined : sweepWhileSeen}
      {...props}
    />
  );
}

export { Skeleton };
