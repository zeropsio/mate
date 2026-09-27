/**
 * What a crewmate's chat says above its composer (PRD §4.5, §5.6): on an
 * earlier conversation, where the crewmate talks now — and that nothing is
 * sent from here, since a send would land there; on the current one,
 * that its next turn brings in a newer brief or job. Probe 22 failed, so a
 * resumed session keeps the prompt it began with: the next turn starts a
 * fresh conversation (BUILD §1).
 *
 * Pure: no clock, no I/O.
 */
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

const FRESH = "the next turn starts a fresh conversation";

export function crewChatNotices(
  row: Pick<CrewmateView, "crewmate" | "pending">,
  threadId: ThreadId,
): CrewChatNotices {
  const { crewmate, pending } = row;
  if (threadId !== crewmate.currentThreadId) {
    return {
      retired: {
        text: `An earlier conversation with @${crewmate.handle} — it goes on in a newer one.`,
        currentThreadId: crewmate.currentThreadId,
        sendBlock: `Write to @${crewmate.handle} in its current conversation`,
      },
      pending: null,
    };
  }
  const job = pending?.job ?? null;
  const brief = pending?.brief ?? null;
  return {
    retired: null,
    pending:
      job !== null && brief !== null
        ? `Job updated to v${job} and brief to v${brief} — ${FRESH}`
        : job !== null
          ? `Job updated to v${job} — ${FRESH}`
          : brief !== null
            ? `Brief updated to v${brief} — ${FRESH}`
            : null,
  };
}
