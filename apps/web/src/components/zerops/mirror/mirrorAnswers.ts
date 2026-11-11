/**
 * What this tab told the engine of each mirror ask, by request, that its record does not say yet:
 * the answer on its way, or the engine's refusal of it. Shared by the ask's card, its dock and the
 * conversation's watch (`MirrorAskWatch`), so each request holds its own and no other's. The
 * engine hears connected at most once per request from this tab, whichever of them saw the remote.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";
import { create } from "zustand";

import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { type MirrorAskPending, mirrorAnswerSettled } from "./mirrorAsk.logic";

export interface MirrorAnswer {
  readonly pending: MirrorAskPending;
  /** The engine's refusal of the last answer, in its words. */
  readonly refusal: string | null;
}

/** How the person, or HQ's remote, answered: never a token. */
export type MirrorSaid =
  | { readonly outcome: "connected"; readonly url: string }
  | { readonly outcome: "declined" };

const NONE: MirrorAnswer = { pending: null, refusal: null };

const useAnswers = create<{ readonly byRequest: Readonly<Record<string, MirrorAnswer>> }>()(() => ({
  byRequest: {},
}));

const setAnswer = (requestId: string, answer: MirrorAnswer) =>
  useAnswers.setState(({ byRequest }) => ({ byRequest: { ...byRequest, [requestId]: answer } }));

/** This tab's answer to one request. */
export function useMirrorAnswer(requestId: string): MirrorAnswer {
  return useAnswers((state) => state.byRequest[requestId] ?? NONE);
}

/** The requests this tab told connected because HQ showed the remote: each once. */
const connectedTold = new Set<string>();

/**
 * Tells the engine how a mirror ask of the thread ended. A press already on its way is not sent
 * twice; HQ's remote answers connected once per request (`once`), and a refusal of that waits for
 * the person's Try again.
 */
export function useTellMirror(environmentId: EnvironmentId, threadRef: ScopedThreadRef) {
  const answerMirrorAsk = useAtomCommand(threadEnvironment.answerMirrorAsk, {
    reportFailure: false,
  });
  return useCallback(
    async (requestId: string, said: MirrorSaid, once = false): Promise<void> => {
      if (once) {
        if (connectedTold.has(requestId)) return;
        connectedTold.add(requestId);
      }
      if (useAnswers.getState().byRequest[requestId]?.pending === said.outcome) return;
      setAnswer(requestId, { pending: said.outcome, refusal: null });
      const result = await answerMirrorAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, ...said },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      // Settled by its Mate (or answered) meanwhile: nothing left to tell it.
      if (mirrorAnswerSettled(error)) return;
      setAnswer(requestId, {
        pending: null,
        refusal: error instanceof Error ? error.message : "The Mate did not take the answer.",
      });
    },
    [answerMirrorAsk, environmentId, threadRef.threadId],
  );
}

/** Whether this tab has a Not now on its way for the request: HQ's remote then answers nothing. */
export const mirrorDeclinePending = (requestId: string): boolean =>
  useAnswers.getState().byRequest[requestId]?.pending === "declined";
