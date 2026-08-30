import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { StatusDot } from "./StatusDot";

type VisibleLivenessState = "live" | "polling" | "doorbell-down" | "last-read-failed";
type LivenessState = VisibleLivenessState | "absent";

const TONE: Record<VisibleLivenessState, ServiceStatusToneId> = {
  live: "ok",
  polling: "busy",
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
      <StatusDot label={label} pulse={state === "polling"} tone={tone} />
    </span>
  );
}

export { LivenessLine };
export type { LivenessLineProps, LivenessState, VisibleLivenessState };
