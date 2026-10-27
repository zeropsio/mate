import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { BadgeTone } from "~/components/ui/badge";

/** A Zerops status's tone as the label that shows it: running is success, working is info. */
export const STATUS_BADGE_TONE: Readonly<Record<ServiceStatusToneId, BadgeTone>> = {
  ok: "success",
  busy: "info",
  attention: "warning",
  failed: "danger",
  off: "neutral",
};
