/**
 * Handing something to the Mate that can do it.
 *
 * Every change to a project goes through the agent's own tools, so a surface
 * that finds work to be done hands it over rather than doing it itself: it
 * opens the Mate's conversation with the request written, and sends it.
 *
 * It used to stop at composing and wait for a keystroke (spec §5.4). Every
 * caller now asks first — a confirm naming the Mate and quoting the request,
 * the same shape *Release* and *Merge* ask in — so the decision has already
 * been made by the time this runs, and a second press would be asking twice
 * (the owner, 2026-09-19: "it should open dialog which would then not only put
 * the text into an agent, but actually send it").
 *
 * The left menu grew this first and kept it to itself; a change's own page
 * needs the same seam, so it lives here and both call it.
 *
 * No Mate we can reach, or no conversation started yet: the projects screen
 * owns connecting and starting one, exactly as selecting the row does.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { findCandidate, type CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import { useZeropsCandidates } from "./useZeropsCandidates";

/** Writes `ask` into the Mate's composer and goes there. */
export type AskMate = (mateProjectId: string | undefined, ask: string) => void;

/**
 * Where an ask goes, from the one lookup of the Mate it names. Only a Mate found connected to an
 * environment is asked there. Every other answer goes to the projects screen, which owns
 * connecting and says what the listing knows: why a Mate cannot be reached, or — while the listing
 * has not answered — that it is still reading (§3.4). An ask never waits unseen for a listing that
 * may not answer.
 */
export type AskMateTarget =
  | { readonly kind: "projects" }
  | { readonly kind: "environment"; readonly environmentId: EnvironmentId };

export function askMateTarget(
  lookup: CandidateLookup<{ readonly environmentId?: EnvironmentId }>,
): AskMateTarget {
  const environmentId = lookup.kind === "found" ? lookup.row.environmentId : undefined;
  return environmentId === undefined
    ? { kind: "projects" }
    : { kind: "environment", environmentId };
}

export function useAskMate(
  options: { readonly onNavigate?: (() => void) | undefined } = {},
): AskMate {
  const router = useRouter();
  const threads = useThreadShells();
  const { listing } = useZeropsCandidates();
  const { onNavigate } = options;

  return useCallback<AskMate>(
    (mateProjectId, ask) => {
      const target: AskMateTarget =
        mateProjectId === undefined
          ? { kind: "projects" }
          : askMateTarget(findCandidate(listing, (row) => row.project.id === mateProjectId));
      const { primary } =
        target.kind === "projects"
          ? { primary: undefined }
          : resolvePrimaryConversation(
              threads.filter((thread) => thread.environmentId === target.environmentId),
            );
      if (target.kind === "projects" || primary === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const threadRef = scopeThreadRef(target.environmentId, primary.id);
      // Sent, not left in the box: every caller now confirms first, so the
      // person has already read the exact request and pressed Send (spec §5.4
      // retired for these surfaces by the owner, 2026-09-19).
      useComposerDraftStore.getState().requestSend(threadRef, ask);
      onNavigate?.();
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [listing, onNavigate, router, threads],
  );
}
