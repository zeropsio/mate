/**
 * Starts a newly created environment's job once there is an agent to run it.
 *
 * "Add Mate" stands an environment up in about two minutes and then stops,
 * one step short of the thing the person asked for: the application is there
 * and not running, and the Mate that could fix that is waiting to be told.
 * The creation already wrote down what the job is (`creationHandoff.ts`);
 * this is what says it.
 *
 * It is the one prompt mate sends by itself. Every other opening message is
 * composed and left for the person to read, because a turn they did not ask
 * for is a turn wasted — but this environment exists *because* they asked, and
 * they watched it being built. What they have not done yet is sign a coding
 * agent in, and until they have there is nothing on the other end, so the send
 * waits for that and for nothing else.
 *
 * The prompt is written here rather than trusted to have been composed
 * already: the compose runs in a route effect and this runs in the chat, and
 * an empty composer sent on a race would spend the turn on nothing.
 *
 * A handoff is spent the moment it is used, so a reconnect, a second tab or a
 * later visit says nothing. If the send does not go through — the thread is
 * busy, the environment dropped — the prompt is still sitting in the composer
 * and the person can send it themselves, which is exactly where they were
 * before this existed.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { creationHandoffPrompt, creationJobToStart } from "@t3tools/client-runtime/zerops";

import { useComposerDraftStore } from "../composerDraftStore";
import { creationHandoffFor, forgetCreationHandoff } from "./creationHandoffStorage";

/**
 * How long to keep offering the job to a composer that is not ready yet, and
 * how often. The provider registry can lag a sign-in by a noticeable moment;
 * past this window the prompt simply stays in the composer for the person to
 * send, which is where they were before any of this existed.
 */
const AUTOSTART_WINDOW_MS = 90_000;
const AUTOSTART_RETRY_MS = 1_500;

export function useZeropsCreationJob(input: {
  readonly environmentId: string | null;
  /** Where the message goes — null while the conversation is still resolving. */
  readonly target: ScopedThreadRef | null;
  /** True while no coding agent is signed in (`chatChrome.ts`). */
  readonly agentSignInRequired: boolean;
  /** False while the thread cannot take a message: connecting, busy, gone. */
  readonly ready: boolean;
  /**
   * Sends what is in the composer, and reports whether it actually went.
   *
   * It must report, because the thing that decides is not observable from
   * here: the composer needs a *provider*, and it refuses the send without
   * one. Not measured failing — the live run sent on the first attempt — but a
   * caller that returns nothing has no way to tell a refused send from a sent
   * one, and spending the job on the attempt loses it in the case it cannot
   * see.
   */
  readonly send: () => boolean;
}): void {
  const { agentSignInRequired, environmentId, ready, target } = input;
  // Held in a ref so a caller's inline closure does not re-run the effect,
  // and kept current in one of its own rather than written during render.
  const sendRef = useRef(input.send);
  useEffect(() => {
    sendRef.current = input.send;
  }, [input.send]);
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    const handoff = creationJobToStart({
      environmentId,
      handoff: environmentId === null ? undefined : creationHandoffFor(environmentId),
      hasTarget: target !== null,
      ready,
      agentSignInRequired,
      startedFor: startedFor.current,
    });
    if (handoff === undefined || target === null || environmentId === null) return;

    // The prompt goes in straight away: whether or not the send lands, the
    // person should find the job written rather than an empty composer.
    useComposerDraftStore.getState().setPrompt(target, creationHandoffPrompt(handoff));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + AUTOSTART_WINDOW_MS;
    const attempt = () => {
      if (sendRef.current()) {
        // Spent only once it is actually said, so a refused send is retried
        // rather than lost.
        startedFor.current = environmentId;
        forgetCreationHandoff(environmentId);
        return;
      }
      if (Date.now() < deadline) timer = setTimeout(attempt, AUTOSTART_RETRY_MS);
    };
    attempt();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [agentSignInRequired, environmentId, ready, target]);
}
