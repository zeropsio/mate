/**
 * Puts the opening message in the composer of a newly connected Zerops
 * environment's first draft — or of its one conversation, when the server
 * made that before anybody spoke into it.
 *
 * It is composed, not sent: zcp needs a first message before it greets anyone,
 * and the person gets to read what will be said before it costs them a turn.
 * An environment that a creation is waiting on is the one exception, and it is
 * not made here — `useZeropsCreationJob` sends that one once a coding agent is
 * signed in, because until then there is nothing to run it.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import { useComposerDraftStore } from "../composerDraftStore";

import {
  ZEROPS_ONBOARDING_PROMPT,
  shouldComposeFirstPrompt,
} from "@t3tools/client-runtime/zerops/firstPrompt";

import { creationHandoffPrompt } from "@t3tools/client-runtime/zerops";

import { creationHandoffFor } from "./creationHandoffStorage";
import {
  connectionOriginFor,
  readFirstPromptMarkers,
  rememberFirstPromptComposed,
} from "./firstPromptStorage";

export function composeZeropsFirstPrompt(input: {
  readonly environmentId: string;
  /** The draft, or the conversation, whose composer gets the message. */
  readonly target: DraftId | ScopedThreadRef;
}): boolean {
  if (
    !shouldComposeFirstPrompt({
      environmentId: input.environmentId,
      alreadyComposed: readFirstPromptMarkers(),
      connectedVia: connectionOriginFor(input.environmentId),
    })
  ) {
    return false;
  }
  // An environment somebody created has a reason to exist, and the creation
  // wrote it down (`creationHandoff.ts`). Asking a Mate that was made for a
  // job to introduce itself instead is a wasted turn.
  const handoff = creationHandoffFor(input.environmentId);
  useComposerDraftStore
    .getState()
    .setPrompt(
      input.target,
      handoff === undefined ? ZEROPS_ONBOARDING_PROMPT : creationHandoffPrompt(handoff),
    );
  rememberFirstPromptComposed(input.environmentId);
  return true;
}
