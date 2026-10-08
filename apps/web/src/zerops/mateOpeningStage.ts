/** Whether the link verdict has a state line for the Mate's conversation composition. */
import type { MateVoice } from "@t3tools/client-runtime/zerops/environments";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { ZeropsAgentActivity } from "./agentActivity";
import { lastKnownMateWords } from "./lastKnownMate.logic";
import { usageLimitHistoryWords } from "./noticeWords";

type Spoken = Exclude<MateVoice, { readonly surface: "none" }>;

export function stageSpeaks(voice: Spoken): boolean {
  // A diagnostic-only line does not supply the composition's headline.
  return voice.text !== null && !voice.processes;
}

/** Opening history preserves known refusal evidence without claiming a current admission state. */
export function openingLimitWords(
  activity: ZeropsAgentActivity | undefined,
  name: string,
  timestampFormat: TimestampFormat = "locale",
): string | undefined {
  if (activity?.limitHistory === undefined) return undefined;
  return (
    lastKnownMateWords(activity, name, timestampFormat) ??
    usageLimitHistoryWords(
      activity.limitHistory.provider,
      activity.at ?? null,
      activity.limitHistory.resetsAt,
      name,
      timestampFormat,
    )
  );
}
