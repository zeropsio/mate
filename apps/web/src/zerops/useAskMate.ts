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
 * A Mate holds a change per branch, each worked in the conversation bound to a
 * lease of that branch: what is asked of a change goes to that conversation,
 * where its work and its leases are, and only else to the main chat.
 *
 * A Mate not connected here, or with no conversation started yet, is asked
 * through its door, exactly as selecting its row opens it (`useOpenMate`): its
 * own view connects it, says what it waits for, and the ask is written in the
 * conversation it hands over to. Only an ask that names no Mate goes to the
 * projects screen.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "@t3tools/client-runtime/zerops";
import { findCandidate, type CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { newCommandId, newMessageId } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useComposerDraftStore, type ComposerSendIds } from "../composerDraftStore";
import { useOpenMate } from "./useOpenMate";
import { useZeropsDetailCandidates } from "./useZeropsCandidates";

/**
 * Writes `ask` into the Mate's composer and goes there: the person chat
 * `options.threadId` names (*Deliver* asks in the chat you are in), else the one
 * bound to a lease of `options.branch` (a change's), else its main chat.
 * Sent at once, unless `options.send` is false: then it waits in the composer,
 * after anything the person had typed, for them to read and send ("Ask <your
 * Mate> to fix it").
 */
export type AskMate = (
  mateProjectId: string | undefined,
  ask: string,
  options?: {
    readonly threadId?: string | undefined;
    /** The branch of the change asked about: its lease's conversation is asked. */
    readonly branch?: string | undefined;
    readonly send?: boolean | undefined;
    /** The send's ids: whoever asked hears what became of it by them (`sendOutcomeOf`). */
    readonly ids?: ComposerSendIds | undefined;
  },
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
 * person chat of this Mate (open, not a crewmate's); else the person chat bound
 * to a lease of `branch`, the most primary of several; otherwise the main chat.
 */
export function askMateThread<
  T extends ZeropsConversationCandidate & {
    readonly lease?: { readonly branch: string | null } | null | undefined;
  },
>(threads: ReadonlyArray<T>, threadId: string | undefined, branch?: string): T | undefined {
  const { primary, hidden } = resolvePrimaryConversation(threads);
  const chats = primary === undefined ? hidden : [primary, ...hidden];
  const named = threadId === undefined ? undefined : chats.find((thread) => thread.id === threadId);
  const bound =
    branch === undefined ? undefined : chats.find((thread) => thread.lease?.branch === branch);
  return named ?? bound ?? primary;
}

/**
 * Where an ask goes, from the one lookup of the Mate it names. A Mate found connected to an
 * environment is asked there. Every other answer goes through its door (`useOpenMate`): its own
 * view connects it and says what it waits for — why it cannot be reached, or, while the listing
 * has not answered, that it is still looking (§3.4) — and the ask is written once its
 * conversation opens. An ask never waits unseen.
 */
export type AskMateTarget =
  | { readonly kind: "mate" }
  | { readonly kind: "environment"; readonly environmentId: EnvironmentId };

export function askMateTarget(
  lookup: CandidateLookup<{ readonly environmentId?: EnvironmentId }>,
): AskMateTarget {
  const environmentId = lookup.kind === "found" ? lookup.row.environmentId : undefined;
  return environmentId === undefined ? { kind: "mate" } : { kind: "environment", environmentId };
}

/**
 * The ids a page's ask is sent with: its asker's, or new ones — marked as the page's, so the
 * conversation is never named by words the person did not type.
 */
export function pageSendIds(
  ids: ComposerSendIds | undefined,
  mint: () => ComposerSendIds,
): ComposerSendIds {
  return { ...(ids ?? mint()), fromPanel: true };
}

/**
 * Writes an ask in a conversation's composer: sent where the person already decided (spec §5.4
 * retired for those surfaces by the owner, 2026-09-19); a request left to be read joins what they
 * had typed.
 */
function askIn(
  threadRef: ScopedThreadRef,
  ask: string,
  send: boolean,
  ids: ComposerSendIds | undefined,
): void {
  const drafts = useComposerDraftStore.getState();
  if (!send) {
    drafts.setPrompt(threadRef, askedDraft(drafts.getComposerDraft(threadRef)?.prompt, ask));
  } else
    drafts.requestSend(
      threadRef,
      ask,
      pageSendIds(ids, () => ({ commandId: newCommandId(), messageId: newMessageId() })),
    );
}

export function useAskMate(
  options: { readonly onNavigate?: (() => void) | undefined } = {},
): AskMate {
  const router = useRouter();
  const threads = useThreadShells();
  const { listing } = useZeropsDetailCandidates();
  const openMate = useOpenMate();
  const { onNavigate } = options;

  return useCallback<AskMate>(
    (mateProjectId, ask, options) => {
      const send = options?.send !== false;
      if (mateProjectId === undefined) {
        void router.navigate({ to: "/zerops" });
        return;
      }
      const lookup = findCandidate(listing, (row) => row.project.id === mateProjectId);
      const target = askMateTarget(lookup);
      const chat =
        target.kind === "mate"
          ? undefined
          : askMateThread(
              threads.filter((thread) => thread.environmentId === target.environmentId),
              options?.threadId,
              options?.branch,
            );
      onNavigate?.();
      if (target.kind === "mate" || chat === undefined) {
        // Its door: the conversation it opens — now, or once its own view hands over — is asked.
        openMate(lookup.kind === "found" ? lookup.row : { projectId: mateProjectId }, (opened) => {
          askIn(opened, ask, send, options?.ids);
        });
        return;
      }
      const threadRef = scopeThreadRef(target.environmentId, chat.id);
      askIn(threadRef, ask, send, options?.ids);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [listing, onNavigate, openMate, router, threads],
  );
}
