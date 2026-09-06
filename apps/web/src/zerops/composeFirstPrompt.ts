/**
 * Puts the opening message in the composer of a newly connected Zerops
 * environment's first draft — or of its one conversation, when the server
 * made that before anybody spoke into it.
 *
 * It is composed, not sent: zcp needs a first message before it greets anyone,
 * and the person gets to read what will be said before it costs them a turn.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import { useComposerDraftStore } from "../composerDraftStore";

import {
  ZEROPS_ONBOARDING_PROMPT,
  shouldComposeFirstPrompt,
} from "@t3tools/client-runtime/zerops/firstPrompt";

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
  useComposerDraftStore.getState().setPrompt(input.target, ZEROPS_ONBOARDING_PROMPT);
  rememberFirstPromptComposed(input.environmentId);
  return true;
}
