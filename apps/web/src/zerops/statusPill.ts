import { statusLabel, statusPulses } from "@t3tools/client-runtime/zerops/statusPresentation";
import type { ThreadStatus } from "@t3tools/shared/threadStatus";

/**
 * A status as a pill says it: its label and whether it pulses. The hue its `toneId` wears is the
 * sidebar's (`THREAD_STATUS_TONE_CLASSES`), keyed by the tone.
 */
export interface ThreadStatusPill extends ThreadStatus {
  readonly label: string;
  readonly pulse: boolean;
}

export function threadStatusPill(status: ThreadStatus): ThreadStatusPill | null {
  const label = statusLabel(status.kind);
  if (label === null) return null;
  return {
    ...status,
    label,
    pulse: statusPulses(status.kind),
  };
}
