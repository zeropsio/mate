/**
 * Puts the opening message in the composer of a newly connected Zerops
 * environment's first draft.
 *
 * It is composed, not sent: zcp needs a first message before it greets anyone,
 * and the person gets to read what will be said before it costs them a turn.
 */

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
  readonly draftId: DraftId;
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
  useComposerDraftStore.getState().setPrompt(input.draftId, ZEROPS_ONBOARDING_PROMPT);
  rememberFirstPromptComposed(input.environmentId);
  return true;
}
