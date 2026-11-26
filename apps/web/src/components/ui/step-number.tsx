import { cva } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Spinner } from "./spinner";

/**
 * A numbered step's mark, before the step's words in a list of what the person does (sign in on a
 * provider's page, pair a Mac) or of what a press will do, in order (a release's plan, putting a
 * change live): its number — or `icon`, a step that is a place rather than a turn — in a 24 px disc
 * on the muted ground. `current` fills it with the action's blue for the step the person is on now
 * (an ask's next step, a wizard's open page); `busy` turns it into a spinner while the step runs,
 * `done` into a check on the success tint, `attention` and `failed` into a mark on the attention
 * and failed tints. A step's progress that the person does not drive, as a log of it, is
 * ProcessSteps. `size="sm"` is an 18 px disc for steps said in a sentence's line rather than as a
 * list's lead (what happens next, a domain's records named in order).
 *
 * `tone` colours a step still to come by whose steps they are: `muted` by default; `tint` in the
 * hue of who they belong to, set as `--step-tint` by a parent (a new Mate's colour on what happens
 * after Create), the number in the page's ink; `annotation` in the picture notes' pink with a
 * light, semibold number, the twin of a note's pin on its picture.
 */
const stepNumberVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium tabular-nums leading-none",
  {
    defaultVariants: { state: "todo", size: "md", tone: "muted" },
    variants: {
      tone: {
        muted: "",
        tint: "",
        annotation: "",
      },
      size: {
        sm: "size-4.5 text-2xs [&_svg]:size-2.5",
        md: "size-6 text-caption [&_svg]:size-3",
      },
      state: {
        todo: "",
        current: "bg-primary text-primary-foreground",
        busy: "text-status-busy-text",
        done: "bg-status-ok/24 text-status-ok-text",
        attention: "bg-status-attention/20 text-status-attention-text",
        failed: "bg-status-failed/20 text-status-failed-text",
      },
    },
    compoundVariants: [
      {
        state: "todo",
        tone: "muted",
        className: "bg-muted text-foreground ring-1 ring-border ring-inset",
      },
      {
        state: "todo",
        tone: "tint",
        className: "bg-(--step-tint,var(--color-primary))/22 text-foreground",
      },
      {
        state: "todo",
        tone: "annotation",
        className: "bg-annotation font-semibold text-stage-foreground",
      },
      { state: "busy", size: "sm", className: "[&_svg]:size-3.5" },
      { state: "busy", size: "md", className: "[&_svg]:size-4.5" },
    ],
  },
);

type StepNumberState = "todo" | "current" | "busy" | "done" | "attention" | "failed";
type StepNumberTone = "muted" | "tint" | "annotation";

function StepNumber({
  n,
  icon,
  state = "todo",
  size = "md",
  tone = "muted",
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  /** The step's place in its list, from 1. */
  readonly n: number;
  /** Drawn in the number's place while the step is to do. */
  readonly icon?: ReactNode;
  readonly state?: StepNumberState;
  /** `sm`: 18 px, for steps said in a line of words. */
  readonly size?: "sm" | "md";
  /** A step still to come: `muted`, in its owner's `tint` (`--step-tint`), or a picture note's `annotation`. */
  readonly tone?: StepNumberTone;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(stepNumberVariants({ state, size, tone }), className)}
      data-slot="step-number"
      data-state={state}
      {...props}
    >
      {state === "done" ? (
        <CheckIcon />
      ) : state === "busy" ? (
        <Spinner />
      ) : state === "failed" || state === "attention" ? (
        "!"
      ) : (
        (icon ?? n)
      )}
    </span>
  );
}

export { StepNumber, type StepNumberState, type StepNumberTone };
