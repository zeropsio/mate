/**
 * What the conversation view shows of a Mate's stand-up (`mateStandUp.ts`): the composer held back
 * while its person waits on it, and the quiet line its ask is drawn as. The Mate's own server
 * sends the ask (`ZeropsSetup`); nothing here sends or clears anything.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { zeropsCommands } from "../state/zeropsCommands";
import { useMateOfEnvironment } from "./accountEnvironments";
import { useMateSetup, refreshMateSetup } from "./useMateSetup";

import { useThreadShells } from "../state/entities";
import { zeropsMateAt } from "./mateIdentities";
import {
  mateStandUpAskLine,
  mateStandUpHoldsComposer,
  type MateStandUpConversation,
} from "./mateStandUp";
import { useMateReadOnly } from "./useMateReadOnly";
import { useZeropsMateDirectory } from "./useZeropsMates";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * The quiet line the stand-up's ask is drawn as, where the conversation is a Mate's main one
 * (`mateStandUpAskLine`); null anywhere else — another chat, a crewmate's, a conversation nobody
 * lives in — where the words are just a message.
 */
export function useMateStandUpAskLine(threadRef: ScopedThreadRef | null): string | null {
  const directory = useZeropsMateDirectory();
  const threads = useThreadShells();
  const environmentId = threadRef?.environmentId ?? null;
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const own = useMemo(
    () => threads.filter((thread) => thread.environmentId === environmentId),
    [environmentId, threads],
  );
  const main =
    threadRef !== null && resolvePrimaryConversation(own).primary?.id === threadRef.threadId;
  const instanceId = own.find((thread) => thread.id === threadRef?.threadId)?.modelSelection
    .instanceId;
  // Somebody else's agent runs it: the viewer reads the ask, they did not make it.
  const readOnly = useMateReadOnly(environmentId, instanceId);
  if (whoLivesHere?.kind !== "mate" || !main) return null;
  return mateStandUpAskLine(whoLivesHere.mate, readOnly ? "someone" : "you");
}

export function useMateStandUp(input: {
  readonly environmentId: EnvironmentId | null;
  /** The conversation on screen while it is read live from its Mate — never a cached copy. */
  readonly threadRef: ScopedThreadRef | null;
  /** The messages it holds, as read live. */
  readonly messageCount: number;
}): {
  readonly holdsComposer: boolean;
  readonly sendFailed: boolean;
  readonly failed: boolean;
  readonly retrying: boolean;
  readonly retry: () => Promise<void>;
} {
  const { environmentId, threadRef, messageCount } = input;
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
  const origin = useMateOfEnvironment(environmentId)?.origin ?? undefined;
  const own = marker !== undefined && marker.by === viewer;
  const { setup } = useMateSetup(
    own && (main || threadRef === null) && messageCount === 0 ? origin : undefined,
  );
  const failed =
    own &&
    (main || threadRef === null) &&
    setup?.standup === "failed" &&
    conversation !== "started";
  const sendFailed = failed && setup?.standupFailure === "send_failed";
  const [retrying, setRetrying] = useState(false);
  const sendAgain = useAtomCommand(zeropsCommands.standUpRetry, "stand-up retry");
  const retry = async () => {
    if (!sendFailed || environmentId === null || retrying) return;
    setRetrying(true);
    try {
      await sendAgain({ environmentId, input: {} });
      if (origin !== undefined) refreshMateSetup(origin);
    } finally {
      setRetrying(false);
    }
  };
  return {
    holdsComposer: mateStandUpHoldsComposer({
      marker: threadRef !== null && !main ? undefined : marker,
      viewer,
      conversation,
      failed,
    }),
    failed,
    sendFailed,
    retrying,
    retry,
  };
}
