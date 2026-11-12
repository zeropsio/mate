/**
 * The person's access their Chief reads with, as this tab asks HQ for it: *keep* has HQ make a
 * personal token with the person's sign-in and keep it for their Chief, replacing any it kept;
 * *forget* has HQ keep none. HQ never answers the token, so none passes through here; what HQ
 * holds comes back as the Chief's person facts (`useOwnChiefToken`).
 *
 * Every Chief registration asks to keep it once HQ holds the registration — the setup
 * (`chiefSetup.ts`) and *Make this my Chief* alike — and the Chief's header asks on a press
 * (`ChiefAccessButton`). A failed ask leaves the registration as it is: its reason stands here, and
 * the header shows it beside the state HQ reports and *Add access*, until the next ask.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { create } from "zustand";

import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { HQ_UNFOLLOWED, type AccountOperations } from "./accountOperations";

export type ChiefAccessAsk = "keep" | "forget";

interface ChiefAccessState {
  /** The ask HQ has not answered yet. */
  readonly pending: ChiefAccessAsk | null;
  /** Why the last ask failed, in plain words; null once one is answered. */
  readonly error: string | null;
}

const INITIAL: ChiefAccessState = { pending: null, error: null };

export const useChiefAccess = create<ChiefAccessState>(() => INITIAL);

onAccountLifetimeClose(() => useChiefAccess.setState(INITIAL));

/** Asks HQ to keep or forget the person's access for their Chief `projectId`; one ask at a time. */
export async function askChiefAccess(input: {
  readonly ask: ChiefAccessAsk;
  readonly operations: AccountOperations;
  readonly orgId: string;
  readonly projectId: string;
}): Promise<void> {
  if (useChiefAccess.getState().pending !== null) return;
  const { ask, operations, orgId, projectId } = input;
  const current = captureAccountLifetime();
  useChiefAccess.setState({ pending: ask, error: null });
  try {
    await operations.run(
      { kind: ask === "keep" ? "keep-chief-token" : "forget-chief-token", orgId, projectId },
      { orgId, unobserved: HQ_UNFOLLOWED },
    );
    if (current()) useChiefAccess.setState({ pending: null });
  } catch (cause) {
    if (current()) useChiefAccess.setState({ pending: null, error: zeropsErrorMessage(cause) });
  }
}
