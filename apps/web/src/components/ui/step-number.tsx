import { cva } from "class-variance-authority";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * A numbered step's mark, before the step's words in a list of what the person does (sign in on a
 * provider's page, pair a Mac): its number in a 24 px disc on the muted ground. `done` turns it
 * into a check on the success tint, `failed` into a mark on the failed tint. A step's progress that
 * the person does not drive is ProcessSteps.
 */
const stepNumberVariants = cva(
  "inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full font-medium text-caption tabular-nums leading-none [&_svg]:size-3",
  {
    defaultVariants: { state: "todo" },
    variants: {
      state: {
        todo: "bg-muted text-foreground ring-1 ring-border ring-inset",
        done: "bg-status-ok/24 text-status-ok-text",
        failed: "bg-status-failed/20 text-status-failed-text",
      },
    },
  },
);

type StepNumberState = "todo" | "done" | "failed";

function StepNumber({
  n,
  state = "todo",
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  /** The step's place in its list, from 1. */
  readonly n: number;
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
      {state === "done" ? <CheckIcon /> : state === "failed" ? "!" : n}
    </span>
  );
}

export { StepNumber, type StepNumberState };
