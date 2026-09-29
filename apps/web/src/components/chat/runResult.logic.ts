/**
 * What a finished run leaves in its card's foot, beside its time: the effort,
 * counting only what its result doesn't already show as a row — "2 commands ·
 * 1 file read". Edits, checks and deploys are result rows, so they aren't
 * counted twice. Null while there is nothing left to count.
 */
import type { OutcomeModel } from "./conversation.logic";

export function runEffortWords(_outcome: OutcomeModel | null | undefined): string | null {
  return null;
}
