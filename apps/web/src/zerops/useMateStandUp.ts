/**
 * The stand-up (`mateStandUp.ts`), sent and cleared from the conversation view
 * of the person who asked for it — once per view, beside the signer record
 * (`ChatView`), since that view is the one place every door to a sign-in ends.
 *
 * It sends through the composer's own send (`requestSend`, the words and the
 * ids the conversation derives), so the turn takes the composer's model,
 * runtime mode and defaults exactly as a message typed there would. It sends
 * only into a conversation read live from its Mate and found empty, once per
 * environment in this session (the guard below), and every other client of
 * the person sends the same command, which the server takes once.
 *
 * What the send came to is published per environment for the empty
 * conversation, which lives deeper in the same view: on its way, or not
 * through — a failed turn start, or a send nobody saw leave — with a way to
 * try again. The conversation holding a message is the ask answered: the tag
 * goes, through the TagWriter's own read-modify-write.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadShells } from "../state/entities";
import { onAccountLifetimeClose } from "./accountLifetime";
import { zeropsMateAt } from "./mateIdentities";
import {
  MATE_STAND_UP_MESSAGE,
  mateStandUpCleared,
  mateStandUpDecision,
  mateStandUpHoldsComposer,
  mateStandUpSendIds,
  type MateStandUpConversation,
} from "./mateStandUp";
import { useZeropsEnvironmentProject } from "./useZeropsAgentSigner";
import { useZeropsMateDirectory } from "./useZeropsMates";
import { runZeropsCommand, ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** A send asked of the composer that nothing saw leave in this long did not go. */
export const MATE_STAND_UP_UNSEEN_MS = 8_000;

export interface MateStandUpAttempt {
  /** 1 for the send every client makes on its own; each Try again is the next. */
  readonly number: number;
  /** `due`: asked again, to go; `sending`: asked of the composer; `failed`: not through. */
  readonly state: "due" | "sending" | "failed";
  /** When it was asked of the composer, wall ms. */
  readonly askedAt: number;
  /** Its send was seen on its way. */
  readonly seen: boolean;
}

// The guard: this session's attempt per environment, whichever view asked it.
const attempts = new Map<EnvironmentId, MateStandUpAttempt>();
const attemptListeners = new Set<() => void>();
// Projects whose ask this session is clearing, or has cleared.
const clearing = new Set<string>();

function setAttempt(environmentId: EnvironmentId, attempt: MateStandUpAttempt): void {
  attempts.set(environmentId, attempt);
  for (const listener of attemptListeners) listener();
}

function subscribeAttempts(listener: () => void): () => void {
  attemptListeners.add(listener);
  return () => {
    attemptListeners.delete(listener);
  };
}

/** The person's Try again: the next attempt, due at once. */
export function retryMateStandUp(environmentId: EnvironmentId): void {
  const current = attempts.get(environmentId);
  if (current?.state !== "failed") return;
  setAttempt(environmentId, { number: current.number + 1, state: "due", askedAt: 0, seen: false });
}

/** What this session's stand-up came to in the environment, for its empty conversation. */
export function useMateStandUpAttempt(
  environmentId: EnvironmentId | null,
): "none" | "sending" | "failed" {
  const read = () => (environmentId === null ? undefined : attempts.get(environmentId)?.state);
  const state = useSyncExternalStore(subscribeAttempts, read, read);
  return state === undefined ? "none" : state === "failed" ? "failed" : "sending";
}

/** Forgets every attempt and clear: the account's session is over. */
export function resetMateStandUpSession(): void {
  attempts.clear();
  clearing.clear();
  for (const listener of attemptListeners) listener();
}

// Like every other account-scoped client state, it goes when the account does.
onAccountLifetimeClose(resetMateStandUpSession);

export function useMateStandUp(input: {
  readonly environmentId: EnvironmentId | null;
  /** The conversation on screen while it is read live from its Mate — never a cached copy. */
  readonly threadRef: ScopedThreadRef | null;
  /** The messages it holds, as read live. */
  readonly messageCount: number;
  /** The composer can send as this person now (D6's gate open, the Mate connected). */
  readonly canSend: boolean;
  /** A send is on its way in this conversation. */
  readonly sendBusy: boolean;
}): { readonly holdsComposer: boolean } {
  const { environmentId, threadRef, messageCount, canSend, sendBusy } = input;
  const directory = useZeropsMateDirectory();
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const marker = whoLivesHere?.kind === "mate" ? whoLivesHere.mate.standUp : undefined;
  const viewer = useZeropsSessionOptional()?.user?.id;
  const threads = useThreadShells();
  // The stand-up goes into the Mate's main conversation, the one opening the Mate lands on.
  const main = useMemo(
    () =>
      threadRef !== null &&
      resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === threadRef.environmentId),
      ).primary?.id === threadRef.threadId,
    [threadRef, threads],
  );
  const conversation: MateStandUpConversation =
    threadRef === null || !main ? "unknown" : messageCount === 0 ? "empty" : "started";
  const readAttempt = () => (environmentId === null ? undefined : attempts.get(environmentId));
  const attempt = useSyncExternalStore(subscribeAttempts, readAttempt, readAttempt);
  const decision = mateStandUpDecision({
    marker,
    viewer,
    conversation,
    signedIn: canSend,
    sentThisSession: attempt !== undefined && attempt.state !== "due",
    sendInFlight: sendBusy,
  });

  useEffect(() => {
    if (decision !== "send" || environmentId === null || threadRef === null) return;
    const current = attempts.get(environmentId);
    // Another view of this session asked it meanwhile.
    if (current !== undefined && current.state !== "due") return;
    const number = current?.number ?? 1;
    setAttempt(environmentId, { number, state: "sending", askedAt: Date.now(), seen: false });
    useComposerDraftStore
      .getState()
      .requestSend(
        threadRef,
        MATE_STAND_UP_MESSAGE,
        mateStandUpSendIds(threadRef.threadId, number),
      );
  }, [decision, environmentId, threadRef]);

  // What the send came to: seen leaving, then held by the conversation, or
  // back to an empty one — or never seen at all.
  useEffect(() => {
    if (environmentId === null || attempt?.state !== "sending") return;
    if (sendBusy) {
      if (!attempt.seen) setAttempt(environmentId, { ...attempt, seen: true });
      return;
    }
    if (conversation !== "empty") return;
    if (attempt.seen) {
      setAttempt(environmentId, { ...attempt, state: "failed" });
      return;
    }
    const timer = window.setTimeout(
      () => {
        const now = attempts.get(environmentId);
        if (now === attempt) setAttempt(environmentId, { ...attempt, state: "failed" });
      },
      Math.max(0, attempt.askedAt + MATE_STAND_UP_UNSEEN_MS - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [attempt, conversation, environmentId, sendBusy]);

  const project = useZeropsEnvironmentProject(environmentId);
  const data = useContext(ZeropsDataContext);
  const cleared = mateStandUpCleared({ marker, viewer, conversation });
  useEffect(() => {
    if (!cleared || project === undefined || data === null) return;
    const key = project.projectId;
    if (clearing.has(key)) return;
    clearing.add(key);
    runZeropsCommand(
      data.runtime.commands.updateProjectTags(data.projectRef(project.orgId, project.projectId), {
        kind: "stand-up-done",
      }),
    ).catch(() => {
      // Left standing, it asks nothing more of a conversation already under
      // way; the conversation's next open clears it again.
      clearing.delete(key);
    });
  }, [cleared, data, project]);

  return {
    holdsComposer: mateStandUpHoldsComposer({
      marker,
      viewer,
      conversation,
      failed: attempt?.state === "failed",
    }),
  };
}
