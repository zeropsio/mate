/**
 * A write whose effect a fact shows (a service published, a project renamed): Zerops's answer is
 * its end, and the same fact is what reflects it — and, after a lost answer, what adopts it: the
 * target's id becomes its handle once the fact shows the effect it did not show at the send.
 *
 * @module data/operations/shownInFacts
 */
import type { OperationIntent, OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { Settlement } from "./kind.ts";

export function shownInFacts<Intent extends OperationIntent>(
  /** The target whose fact shows the effect: its id is the operation's handle. */
  targetOf: (intent: Intent) => string,
  shows: (read: ProjectionReads, intent: Intent) => boolean,
) {
  return {
    reflected: (read: ProjectionReads, intent: Intent, _receipt: OperationReceipt) =>
      shows(read, intent),
    settledBy: (
      read: ProjectionReads,
      intent: Intent,
      _receipt: OperationReceipt,
    ): Settlement | null => (shows(read, intent) ? { kind: "succeeded" } : null),
    effectHandles: (read: ProjectionReads, intent: Intent) =>
      shows(read, intent) ? [targetOf(intent)] : [],
  };
}
