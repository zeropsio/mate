/**
 * The mounted account's hold on each running press's HQ stream (`keepPress`): held for as long as
 * the account's data is (`ZeropsAccountData`), so a press keeps its organization's HQ stream open
 * — its hold at HQ lives with it — whichever organization is shown.
 */
import type { AccountObservation, KeepPress } from "@t3tools/client-runtime/data";

let held: AccountObservation["keepPress"] | null = null;

/** Holds the account's press keeper; answers its release. */
export function holdPressStreams(keep: AccountObservation["keepPress"]): () => void {
  held = keep;
  return () => {
    if (held === keep) held = null;
  };
}

/** What keeps a press of the organization's HQ stream open; `null` outside an account. */
export function pressStreamOf(orgId: string): KeepPress | null {
  const keep = held;
  return keep === null ? null : (projectId, lapsed) => keep(orgId, projectId, lapsed);
}
