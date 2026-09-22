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
 *
 * That exception is total, not a fallback (R5): an environment with a
 * pending hand-off writes nothing here at all, ever. This ran in a route
 * effect and the job in the chat's, and both used to write the same
 * composer — if the job ran first it spent (forgot) the hand-off before
 * this effect got to read it, so this then wrote the generic onboarding
 * line over the job's own prompt. `useZeropsCreationJob` is the only writer
 * for as long as a hand-off exists; once it is spent, this composes the
 * ordinary way for whatever the environment turns out to need next.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import { useComposerDraftStore } from "../composerDraftStore";

import {
  ZEROPS_ONBOARDING_PROMPT,
  shouldComposeFirstPrompt,
} from "@t3tools/client-runtime/zerops/firstPrompt";

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
  // An environment somebody created has a reason to exist, and the creation
  // wrote it down (`creationHandoff.ts`). `useZeropsCreationJob` is the only
  // writer of the composer for as long as that hand-off stands — composing
  // here too raced it (R5): if the job ran first it forgot the hand-off
  // before this read it, so this then overwrote the job's real prompt with
  // the generic onboarding line.
  if (creationHandoffFor(input.environmentId) !== undefined) return false;

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
