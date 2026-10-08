import type { MateInterruption } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatDayAwareTimestamp } from "../timestampFormat";

export function restartWords(
  name: string,
  interruption: MateInterruption,
  format: TimestampFormat,
): string {
  const verb = interruption.restart.cause === "stopped" ? "stopped" : "restarted";
  return interruption.restart.at === null
    ? `${name} ${verb}`
    : `${name} ${verb} at ${formatDayAwareTimestamp(interruption.restart.at, format)}`;
}
