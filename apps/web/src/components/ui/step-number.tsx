import { cva } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Spinner } from "./spinner";

/**
 * A numbered step's mark, before the step's words in a list of what the person does (sign in on a
 * provider's page, pair a Mac) or of what a press will do, in order (a release's plan, putting a
 * change live): its number — or `icon`, a step that is a place rather than a turn — in a 24 px disc
 * on the muted ground. `busy` turns it into a spinner while the step runs, `done` into a check on
 * the success tint, `attention` and `failed` into a mark on the attention and failed tints. A
 * step's progress that the person does not drive, as a log of it, is ProcessSteps.
 */
const stepNumberVariants = cva(
  "inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full font-medium text-caption tabular-nums leading-none [&_svg]:size-3",
  {
    defaultVariants: { state: "todo" },
    variants: {
      state: {
        todo: "bg-muted text-foreground ring-1 ring-border ring-inset",
        busy: "text-status-busy-text [&_svg]:size-4.5",
        done: "bg-status-ok/24 text-status-ok-text",
        attention: "bg-status-attention/20 text-status-attention-text",
        failed: "bg-status-failed/20 text-status-failed-text",
      },
    },
  },
);

type StepNumberState = "todo" | "busy" | "done" | "attention" | "failed";

function StepNumber({
  n,
  icon,
  state = "todo",
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  /** The step's place in its list, from 1. */
  readonly n: number;
  /** Drawn in the number's place while the step is to do. */
  readonly icon?: ReactNode;
  readonly state?: StepNumberState;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(stepNumberVariants({ state }), className)}
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

export { StepNumber, type StepNumberState };
