/**
 * Handing something to the Mate that can do it.
 *
 * Every change to a project goes through the agent's own tools, so a surface
 * that finds work to be done does not do it: it opens the Mate's conversation
 * with the request already written and stops there, and the person presses
 * send. That is the seam the quick actions and the file browser already use
 * (spec §5.4) — "you still need the agent to take care of it, so why can't
 * 'needs a rebase' simply prompt it automatically to do the rebase?" (the
 * owner, 2026-09-19).
 *
 * The left menu grew this first and kept it to itself; a change's own page
 * needs the same seam, so it lives here and both call it.
 *
 * No Mate we can reach, or no conversation started yet: the projects screen
 * owns connecting and starting one, exactly as selecting the row does.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import { rememberZeropsEnvironment } from "./firstPromptStorage";
import { useZeropsCandidates } from "./useZeropsCandidates";

/** Writes `ask` into the Mate's composer and goes there. */
export type AskMate = (mateProjectId: string | undefined, ask: string) => void;

export function useAskMate(
  options: { readonly onNavigate?: (() => void) | undefined } = {},
): AskMate {
  const router = useRouter();
  const threads = useThreadShells();
  const { candidates } = useZeropsCandidates();
  const { onNavigate } = options;

  return useCallback<AskMate>(
    (mateProjectId, ask) => {
      const candidate =
        mateProjectId === undefined
          ? undefined
          : candidates.find((entry) => entry.project.id === mateProjectId);
      const environmentId = candidate?.environmentId;
      const { primary } =
        environmentId === undefined
          ? { primary: undefined }
          : resolvePrimaryConversation(
              threads.filter((thread) => thread.environmentId === environmentId),
            );
      if (environmentId === undefined || primary === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const threadRef = scopeThreadRef(environmentId, primary.id);
      useComposerDraftStore.getState().setPrompt(threadRef, ask);
      rememberZeropsEnvironment(String(environmentId));
      onNavigate?.();
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [candidates, onNavigate, router, threads],
  );
}
