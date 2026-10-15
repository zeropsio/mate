import { useAtomValue } from "@effect/atom-react";
import { mateActionsForEnvironmentAtom } from "@t3tools/client-runtime/data";
/**
 * What the conversation view shows of a Mate's stand-up (`mateStandUp.ts`): the composer held back
 * while its person waits on it, and the quiet line its ask is drawn as. The Mate's own server
 * sends the ask (`ZeropsSetup`); nothing here sends or clears anything.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
  mateStandUpAwaitedIn,
  mateStandUpConversation,
  mateStandUpHandOver,
  mateStandUpHoldsComposer,
  type MateStandUpConversation,
} from "./mateStandUp";
import { useZeropsMateDirectory } from "./useZeropsMates";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * The quiet line the stand-up's ask is drawn as, where the conversation is a Mate's main one
 * (`mateStandUpAskLine`); null anywhere else — another chat, a crewmate's, a conversation nobody
 * lives in — where the words are just a message.
 */
export function useMateStandUpAskLine(threadRef: ScopedThreadRef | null): string | null {
  const directory = useZeropsMateDirectory();
  const viewer = useZeropsSessionOptional()?.user?.id;
  const threads = useThreadShells();
  const environmentId = threadRef?.environmentId ?? null;
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const own = useMemo(
    () => threads.filter((thread) => thread.environmentId === environmentId),
    [environmentId, threads],
  );
  const main =
    threadRef !== null && resolvePrimaryConversation(own).primary?.id === threadRef.threadId;
  if (whoLivesHere?.kind !== "mate" || !main) return null;
  return mateStandUpAskLine(whoLivesHere.mate, viewer);
}

export function useMateStandUp(input: {
  readonly environmentId: EnvironmentId | null;
  /** The server conversation on screen, as read so far; null for a draft. */
  readonly threadRef: ScopedThreadRef | null;
  /** The messages it holds, as read so far. */
  readonly messageCount: number;
  /** It is read live from its Mate, not a copy being read again (`mateStandUpConversation`). */
  readonly live: boolean;
}): {
  readonly holdsComposer: boolean;
  readonly sendFailed: boolean;
  readonly failed: boolean;
  readonly retrying: boolean;
  readonly retry: () => Promise<void>;
} {
  const { environmentId, threadRef, messageCount, live } = input;
  const directory = useZeropsMateDirectory();
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const marker = whoLivesHere?.kind === "mate" ? whoLivesHere.mate.standUp : undefined;
  const session = useZeropsSessionOptional();
  const viewer = session?.user?.id;
  const orgId = session?.activeOrganization?.id;
  const threads = useThreadShells();
  // The stand-up goes into the Mate's main conversation, the one opening the Mate lands on.
  const primary = useMemo(
    () =>
      environmentId === null
        ? undefined
        : resolvePrimaryConversation(
            threads.filter((thread) => thread.environmentId === environmentId),
          ).primary,
    [environmentId, threads],
  );
  const main = threadRef !== null && primary?.id === threadRef.threadId;
  const awaitedHere = mateStandUpAwaitedIn({
    conversation: threadRef === null ? "draft" : main ? "main" : "other",
    mateHasConversation: primary !== undefined,
  });
  const conversation: MateStandUpConversation = mateStandUpConversation({
    main: threadRef === null ? null : main,
    messageCount,
    live,
  });
  const origin = useMateOfEnvironment(environmentId)?.origin ?? undefined;
  const own = marker !== undefined && marker.by === viewer;
  const { setup } = useMateSetup(own && awaitedHere && messageCount === 0 ? origin : undefined);
  const failed = own && awaitedHere && setup?.standup === "failed" && conversation !== "started";
  const sendFailed = failed && setup?.standupFailure === "send_failed";
  const [submitting, setRetrying] = useState(false);
  const actions = useAtomValue(mateActionsForEnvironmentAtom(environmentId ?? ""));
  const retrying =
    submitting || actions.some((action) => action.action === "standUpRetry" && action.pending);
  const sendAgain = useAtomCommand(zeropsCommands.standUpRetry, "stand-up retry");
  const retry = async () => {
    if (
      !sendFailed ||
      environmentId === null ||
      retrying ||
      origin === undefined ||
      orgId === undefined
    )
      return;
    setRetrying(true);
    try {
      await sendAgain({ environmentId, input: { orgId, origin } });
      if (origin !== undefined) refreshMateSetup(origin);
    } finally {
      setRetrying(false);
    }
  };
  return {
    holdsComposer: mateStandUpHoldsComposer({
      marker: awaitedHere ? marker : undefined,
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

/**
 * Where a draft that waited on its person's stand-up hands over to (`mateStandUpHandOver`): the
 * Mate's main conversation once the ask made it, else null. Whether the draft opened before the
 * Mate had a conversation is read once, at its first render.
 */
export function useMateStandUpHandOver(
  draft: {
    /** Which draft: a route that moves to another draft reads it afresh. */
    readonly key: string;
    readonly environmentId: EnvironmentId;
    readonly typed: boolean;
  } | null,
): ScopedThreadRef | null {
  const directory = useZeropsMateDirectory();
  const viewer = useZeropsSessionOptional()?.user?.id;
  const threads = useThreadShells();
  const environmentId = draft?.environmentId ?? null;
  const { primary } = resolvePrimaryConversation(
    threads.filter((thread) => thread.environmentId === environmentId),
  );
  const [opened, setOpened] = useState(() => ({
    key: draft?.key,
    beforeConversation: primary === undefined,
  }));
  if (opened.key !== draft?.key) {
    setOpened({ key: draft?.key, beforeConversation: primary === undefined });
  }
  if (draft === null) return null;
  const whoLivesHere = zeropsMateAt(directory, draft.environmentId);
  if (whoLivesHere.kind !== "mate") return null;
  const threadId = mateStandUpHandOver({
    marker: whoLivesHere.mate.standUp,
    viewer,
    openedBeforeConversation: opened.beforeConversation,
    typed: draft.typed,
    main: primary,
  });
  return threadId === undefined ? null : scopeThreadRef(draft.environmentId, threadId);
}
