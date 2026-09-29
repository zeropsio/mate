/**
 * What a crewmate's chat says above its composer (PRD §4.5, §5.6): on an
 * earlier conversation, where the crewmate talks now — and that nothing is
 * sent from here, since a send would go there; on the current one, that its
 * job or the crew's goal changed, with no version. Probe 22 failed, so a
 * resumed session keeps the prompt it began with: its next message starts a
 * fresh conversation (BUILD §1).
 *
 * Pure: no clock, no I/O.
 */
import {
  crewEarlierStintNotice,
  crewPendingNotice,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ThreadId } from "@t3tools/contracts";

export interface CrewChatNotices {
  readonly retired: {
    readonly text: string;
    readonly currentThreadId: ThreadId | null;
    /** Why Send is disabled here. */
    readonly sendBlock: string;
  } | null;
  readonly pending: string | null;
}

export function crewChatNotices(
  row: Pick<CrewmateView, "crewmate" | "pending">,
  threadId: ThreadId,
): CrewChatNotices {
  const { crewmate, pending } = row;
  if (threadId !== crewmate.currentThreadId) {
    return {
      retired: {
        ...crewEarlierStintNotice(crewmate.displayName),
        currentThreadId: crewmate.currentThreadId,
      },
      pending: null,
    };
  }
  return { retired: null, pending: pending === null ? null : crewPendingNotice(pending) };
}
