import { ICON_MAP, type ServiceStatusToneId } from "@t3tools/shared/brand";
import { CheckIcon, CircleAlertIcon, ClockIcon, PlayIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { MicroLabel } from "./MicroLabel";

type ProcessStepState = "queued" | "running" | "done" | "failed";

type ProcessStep = Readonly<{
  id: string;
  label: string;
  state: ProcessStepState;
  stateLabel: string;
}>;

const ICON_COMPONENT = {
  Check: CheckIcon,
  CircleAlert: CircleAlertIcon,
  Clock: ClockIcon,
  Play: PlayIcon,
} as const;

const PRESENTATION = {
  queued: {
    icon: ICON_MAP.queued,
    className: "border-[var(--zerops-status-off)] text-[var(--zerops-status-off)]",
    tone: "off",
  },
  running: {
    icon: ICON_MAP.running,
    className: "border-[var(--zerops-status-busy)] text-[var(--zerops-status-busy)]",
    tone: "busy",
  },
  done: {
    icon: ICON_MAP.done,
    className: "border-[var(--zerops-status-ok)] text-[var(--zerops-status-ok)]",
    tone: "ok",
  },
  failed: {
    icon: ICON_MAP.failed,
    className: "border-[var(--zerops-status-failed)] text-[var(--zerops-status-failed)]",
    tone: "failed",
  },
} as const satisfies Record<
  ProcessStepState,
  { icon: keyof typeof ICON_COMPONENT; className: string; tone: ServiceStatusToneId }
>;

type ProcessStepsProps = Omit<React.ComponentProps<"ol">, "children"> & {
  readonly steps: ReadonlyArray<ProcessStep>;
};

function ProcessSteps({
  "aria-label": ariaLabel = "Process steps",
  className,
  steps,
  ...props
}: ProcessStepsProps) {
  return (
    <ol
      {...props}
      aria-label={ariaLabel}
      className={cn("space-y-2", className)}
      data-zerops-primitive="process-steps"
    >
      {steps.map((step) => {
        const { icon, className: glyphClassName, tone } = PRESENTATION[step.state];
        const Icon = ICON_COMPONENT[icon];

        return (
          <li
            aria-current={step.state === "running" ? "step" : undefined}
            className="grid grid-cols-[var(--zerops-process-step-column)_1fr] items-start gap-2"
            data-zerops-process-state={step.state}
            data-zerops-process-tone={tone}
            key={step.id}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-[var(--zerops-process-step-glyph-size)] items-center justify-center rounded-full border-[length:var(--zerops-process-step-border-width)]",
                glyphClassName,
                step.state === "running" && "animate-status-pulse motion-reduce:animate-none",
              )}
            >
              <Icon className="size-2.5" data-zerops-process-icon={icon} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{step.label}</span>
              <MicroLabel>{step.stateLabel}</MicroLabel>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export { ProcessSteps };
export type { ProcessStep, ProcessStepState, ProcessStepsProps };
