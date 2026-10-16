import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { STATUS_BADGE_TONE } from "./statusBadgeTone";
import { Badge } from "~/components/ui/badge";

type VisibleLivenessState = "live" | "recovering" | "doorbell-down" | "last-read-failed";
type LivenessState = VisibleLivenessState | "absent";

const TONE: Record<VisibleLivenessState, ServiceStatusToneId> = {
  live: "ok",
  recovering: "busy",
  "doorbell-down": "off",
  "last-read-failed": "failed",
};

type VisibleLivenessLineProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly label: string;
  readonly state: VisibleLivenessState;
};

type AbsentLivenessLineProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly label?: never;
  readonly state: "absent";
};

type LivenessLineProps = VisibleLivenessLineProps | AbsentLivenessLineProps;

function LivenessLine(props: LivenessLineProps) {
  if (props.state === "absent") {
    return null;
  }

  const { className, label, state, ...spanProps } = props;
  const tone = TONE[state];

  return (
    <span
      {...spanProps}
      className={cn("block min-w-0", className)}
      data-zerops-liveness={state}
      data-zerops-liveness-tone={tone}
      data-zerops-primitive="liveness-line"
    >
      <Badge dot pulse={state === "recovering"} tone={STATUS_BADGE_TONE[tone]}>
        {label}
      </Badge>
    </span>
  );
}

export { LivenessLine };
export type { LivenessLineProps, LivenessState, VisibleLivenessState };
