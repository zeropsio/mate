"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * A picture or a page shown in a frame of its own: a screenshot, a picture someone sent, a
 * design, a page a Mate published. Its corners clip what it holds and its hairline is drawn over
 * it, so a white screenshot still meets the ground it stands on; a quiet ground fills it until its
 * picture is there. While its picture is still on its way (`waiting`, or an `AssetImage` inside
 * still read) it holds its room unpainted, no ground and no edge, so nothing moves when the
 * picture comes or never does. Under a press around
 * it (a `Button variant="bare"` that opens the viewer) its hairline firms on hover.
 *
 * `size` is its corner: `card` for a picture standing in a conversation or a report, `control` for
 * a thumbnail in a strip or a row. `tone` is its edge's ink: `attention` for a picture of a check
 * that was retried, `failed` for one that failed.
 */
const pictureFrameVariants = cva(
  "relative block overflow-hidden bg-foreground/5 after:pointer-events-none after:absolute after:inset-0 after:inset-ring after:transition-shadow after:duration-150 after:ease-out-strong motion-reduce:after:transition-none data-waiting:bg-transparent data-waiting:after:inset-ring-0 has-data-image-pending:bg-transparent has-data-image-pending:after:inset-ring-0 [&>[data-image-frame]]:block [&>[data-image-frame]]:size-full",
  {
    defaultVariants: { size: "card", tone: "default" },
    variants: {
      size: {
        card: "rounded-card after:rounded-card",
        control: "rounded-control after:rounded-control",
      },
      tone: {
        default: "after:inset-ring-foreground/10 [:hover>&]:after:inset-ring-foreground/20",
        attention: "after:inset-ring-status-attention",
        failed: "after:inset-ring-status-failed",
      },
    },
  },
);

type PictureFrameProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof pictureFrameVariants> & {
    /** Its picture is still on its way: the frame holds its room and paints nothing. */
    readonly waiting?: boolean | undefined;
  };

function PictureFrame({ className, render, size, tone, waiting, ...props }: PictureFrameProps) {
  const defaultProps = {
    className: cn(pictureFrameVariants({ size, tone }), className),
    "data-slot": "picture-frame",
    "data-waiting": waiting ? "" : undefined,
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { PictureFrame };
