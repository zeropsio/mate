"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { MateTintId } from "@t3tools/shared/brand";
import { cva, type VariantProps } from "class-variance-authority";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

/**
 * One message in a conversation, in the look of who said it; the one place a message's look
 * changes. Every speaker's words stand at the prose size on a 12 px round.
 *
 * - `person`: the person's words, on the message ground, on their side (the caller ends the row).
 *   `queued`: their words waiting for the running turn, with what it waits for under them: a
 *   dashed hairline and no ground, their words a step quieter.
 * - `mate`: a Mate's words to the person in its run, in its hue (`tint`, or the `--mate-tint`
 *   it stands in), lightly, hugging what it says: the run's one bubble among rows.
 * - `another-mate`: a message another of the person's Mates sent, standing on the page as its
 *   own voice: a wash of its hue and an edge in it, room for its name over its words.
 * - `to-another-mate`: a Mate's words that went to another of the person's Mates, not to the
 *   person: that Mate's edge and no wash, room for its name over the words.
 */
const messageBubbleVariants = cva("min-w-0 rounded-card text-prose", {
  defaultVariants: { speaker: "person", queued: false },
  variants: {
    speaker: {
      person: "",
      mate: "w-fit max-w-full overflow-hidden bg-(--mate-tint)/17 px-3 py-2 leading-5 text-foreground",
      "another-mate": "border border-mate-edge bg-mate-wash px-4 py-3 text-foreground",
      "to-another-mate": "border border-mate-edge px-4 py-3 text-foreground",
    },
    queued: { true: "", false: "" },
  },
  compoundVariants: [
    {
      speaker: "person",
      queued: false,
      className: "bg-message px-3.5 py-2.5 text-message-foreground",
    },
    {
      speaker: "person",
      queued: true,
      className: "border border-border border-dashed px-3.5 py-3 text-message-foreground/80",
    },
  ],
});

type MessageBubbleProps = useRender.ComponentProps<"div"> &
  VariantProps<typeof messageBubbleVariants> & {
    /** A Mate's own hue; without it the bubble wears the `--mate-tint` of where it stands. */
    readonly tint?: MateTintId | undefined;
  };

function MessageBubble({
  className,
  render,
  speaker,
  queued,
  tint,
  style,
  ...props
}: MessageBubbleProps) {
  const defaultProps = {
    className: cn(messageBubbleVariants({ speaker, queued }), className),
    "data-slot": "message-bubble",
    "data-speaker": speaker ?? "person",
    style:
      tint === undefined
        ? style
        : ({ "--mate-tint": `var(--zerops-mate-tint-${tint})`, ...style } as CSSProperties),
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { MessageBubble };
