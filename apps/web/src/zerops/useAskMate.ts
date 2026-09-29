/**
 * Handing something to the Mate that can do it.
 *
 * Every change to a project goes through the agent's own tools, so a surface
 * that finds work to be done hands it over rather than doing it itself: it
 * opens the Mate's conversation with the request written, and sends it — or
 * leaves it there for the person to finish.
 *
 * Sent where the person has already decided: the caller asked first (a change
 * page's Ask, a crew's delivery), or the request follows a press whose next
 * step is the Mate's (words said on a change, ports just opened). A second
 * press would be asking twice (the owner, 2026-09-19: "not only put the text
 * into an agent, but actually send it").
 *
 * Left unsent (`send: false`) where the person still writes: a review's "Ask
 * Nova to fix it" and "Ask Nova for changes" put the request in the composer,
 * after whatever the person had typed there, never over it (`askedDraft`).
 *
 * One seam for every surface that hands work over — a change's page, the
 * crew, the review — so each asks the same way.
 *
 * No Mate we can reach, or no conversation started yet: the projects screen
 * owns connecting and starting one, exactly as selecting the row does.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "@t3tools/client-runtime/zerops";
import { findCandidate, type CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import { useZeropsCandidates } from "./useZeropsCandidates";

/**
 * Writes `ask` into the Mate's composer and goes there: its main chat, or the
 * person chat `options.threadId` names (*Deliver* asks in the chat you are in).
 * Sent at once, unless `options.send` is false: then it waits in the composer,
 * after anything the person had typed, for them to read and send ("Ask <your
 * Mate> to fix it").
 */
export type AskMate = (
  mateProjectId: string | undefined,
  ask: string,
  options?: { readonly threadId?: string | undefined; readonly send?: boolean | undefined },
) => void;

/**
 * What the composer holds once a request is left in it unsent: the request alone in an empty box;
 * after what the person had typed, a blank line apart, where they go on writing. Their words are
 * never replaced, and the same request asked again is not written twice.
 */
export function askedDraft(draft: string | undefined, ask: string): string {
  const kept = draft?.trimEnd() ?? "";
  if (kept.length === 0) return ask;
  if (kept.endsWith(ask.trimEnd())) return draft ?? ask;
  return `${kept}\n\n${ask}`;
}

/**
 * The chat an ask goes to among a Mate's threads: the one named when it is a
 * person chat of this Mate (open, not a crewmate's), otherwise the main chat.
 */
export function askMateThread<T extends ZeropsConversationCandidate>(
  threads: ReadonlyArray<T>,
  threadId: string | undefined,
): T | undefined {
  const { primary, hidden } = resolvePrimaryConversation(threads);
  const named =
    threadId === undefined
      ? undefined
      : [primary, ...hidden].find((thread) => thread?.id === threadId);
  return named ?? primary;
}

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
    (mateProjectId, ask, options) => {
      const target: AskMateTarget =
        mateProjectId === undefined
          ? { kind: "projects" }
          : askMateTarget(findCandidate(listing, (row) => row.project.id === mateProjectId));
      const chat =
        target.kind === "projects"
          ? undefined
          : askMateThread(
              threads.filter((thread) => thread.environmentId === target.environmentId),
              options?.threadId,
            );
      if (target.kind === "projects" || chat === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const threadRef = scopeThreadRef(target.environmentId, chat.id);
      // Sent where the person already decided (spec §5.4 retired for those
      // surfaces by the owner, 2026-09-19); a request left to be read joins
      // what they had typed.
      const drafts = useComposerDraftStore.getState();
      if (options?.send === false) {
        drafts.setPrompt(threadRef, askedDraft(drafts.getComposerDraft(threadRef)?.prompt, ask));
      } else drafts.requestSend(threadRef, ask);
      onNavigate?.();
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [listing, onNavigate, router, threads],
  );
}
