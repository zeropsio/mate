import { useAtomValue } from "@effect/atom-react";
import {
  mateActionsForEnvironmentAtom,
  standUpVerdictOf,
  type MateFeedReading,
} from "@t3tools/client-runtime/data";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
/**
 * What the conversation view shows of a Mate's stand-up (`mateStandUp.ts`): the composer held back
 * while its person waits on it, the quiet line its ask is drawn as, and zcp's failed stand-up with
 * its one way on. The Mate's own server sends the ask (`ZeropsSetup`); nothing here clears anything.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import {
  OrchestrationDispatchCommandError,
  type EnvironmentId,
  type ScopedThreadRef,
  type StandUpVerdictReading,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom, AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { zeropsCommands } from "../state/zeropsCommands";
import { useMateOfEnvironment } from "./accountEnvironments";
import { useMateSetup, refreshMateSetup } from "./useMateSetup";
import { zeropsFeeds } from "./feeds";

import { useEnvironmentConversationsRead, useThreadShells } from "../state/entities";
import { zeropsMateAt } from "./mateIdentities";
import {
  mateStandUpAskLine,
  mateStandUpAwaitedIn,
  mateStandUpConversation,
  mateStandUpHandOver,
  mateStandUpHoldsComposer,
  mateSetupFailure,
  type MateSetupFailure,
  type MateSetupHandOver,
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

const NO_VERDICT = Atom.make<MateFeedReading<StandUpVerdictReading>>({
  state: "unread",
  waitingFor: null,
});

const isDispatchError = Schema.is(OrchestrationDispatchCommandError);

function handOverAnswer(
  result: AtomCommandResult<boolean, unknown>,
): MateSetupHandOver | { readonly kind: "went" } {
  if (AsyncResult.isSuccess(result)) return { kind: result.value ? "went" : "refused" };
  const error = AsyncResult.isFailure(result)
    ? Cause.findErrorOption(result.cause)
    : Option.none<unknown>();
  return Option.isSome(error) && isDispatchError(error.value)
    ? { kind: "failed", words: error.value.message }
    : { kind: "unreachable" };
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
  /** The stand-up waits in this conversation (`mateStandUpAwaitedIn`). */
  readonly awaited: boolean;
  readonly holdsComposer: boolean;
  readonly sendFailed: boolean;
  readonly failed: boolean;
  /** A Try again is in flight, or its attempt not settled yet. */
  readonly retrying: boolean;
  /**
   * One Try again, answered as the Mate answered it: it went, it was refused (no failed setup of
   * the caller's to start), or it never reached the Mate; null while another is in flight. The
   * Mate decides whose setup it is: the caller offers it only to the person it runs for.
   */
  readonly retry: () => Promise<"went" | "refused" | "unreachable" | null>;
  /**
   * zcp's failed stand-up, in the Mate's main conversation only — the one its hand-over wakes —
   * and its one way on: handed to an agent turn there. Null elsewhere, while it builds, once it
   * stood, and once handed over from here.
   */
  readonly setupFailure: {
    /** The verdict it says: an answer holds for it, and a new verdict starts with none. */
    readonly key: string;
    readonly failure: MateSetupFailure;
    readonly handOver: () => void;
    readonly answer: MateSetupHandOver | undefined;
  } | null;
} {
  const { environmentId, threadRef, messageCount, live } = input;
  const directory = useZeropsMateDirectory();
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const marker = whoLivesHere?.kind === "mate" ? whoLivesHere.mate.standUp : undefined;
  const session = useZeropsSessionOptional();
  const viewer = session?.user?.id;
  const orgId = session?.activeOrganization?.id;
  const threads = useThreadShells();
  const mateConversations = useMemo(
    () =>
      environmentId === null
        ? []
        : threads.filter((thread) => thread.environmentId === environmentId),
    [environmentId, threads],
  );
  // The stand-up goes into the Mate's main conversation, the one opening the Mate lands on.
  const primary = useMemo(
    () => resolvePrimaryConversation(mateConversations).primary,
    [mateConversations],
  );
  const conversationsRead = useEnvironmentConversationsRead(environmentId);
  const main = threadRef !== null && primary?.id === threadRef.threadId;
  // A ref none of the Mate's conversations holds is a draft's, however it is named.
  const draft =
    threadRef === null || !mateConversations.some((thread) => thread.id === threadRef.threadId);
  // zcp's own stand-up, where it wrote a verdict: nothing waits on an ask; a failed one is offered
  // to an agent here instead (`setupFailure`).
  const verdict = standUpVerdictOf(
    useAtomValue(environmentId === null ? NO_VERDICT : zeropsFeeds.standUpVerdict(environmentId)),
  );
  const awaitedHere = mateStandUpAwaitedIn({
    byZcp: verdict !== null,
    conversation: draft ? "draft" : main ? "main" : "other",
    mateHasConversation: primary !== undefined,
    conversationsRead,
  });
  const conversation: MateStandUpConversation = mateStandUpConversation({
    main: threadRef === null ? null : main,
    messageCount,
    live,
  });
  const located = useMateOfEnvironment(environmentId);
  const origin = located?.origin ?? undefined;
  const own = marker !== undefined && marker.by === viewer;
  const { setup } = useMateSetup(own && awaitedHere && messageCount === 0 ? located : undefined);
  const failed = own && awaitedHere && setup?.standup === "failed" && conversation !== "started";
  const sendFailed = failed && setup?.standupFailure === "send_failed";
  const [submitting, setRetrying] = useState(false);
  const actions = useAtomValue(mateActionsForEnvironmentAtom(environmentId ?? ""));
  const retrying =
    submitting || actions.some((action) => action.action === "standUpRetry" && action.pending);
  const sendAgain = useAtomCommand(zeropsCommands.standUpRetry, "stand-up retry");
  const retry = useCallback(async () => {
    if (retrying) return null;
    if (environmentId === null || origin === undefined || orgId === undefined) return "unreachable";
    setRetrying(true);
    try {
      const answer = await sendAgain({ environmentId, input: { orgId, origin } });
      refreshMateSetup(origin);
      if (!AsyncResult.isSuccess(answer)) return "unreachable";
      return answer.value ? "went" : "refused";
    } finally {
      setRetrying(false);
    }
  }, [environmentId, orgId, origin, retrying]);
  const failure = main && !draft ? mateSetupFailure(verdict) : null;
  const failureKey = failure === null ? "" : JSON.stringify(verdict);
  const [handedOver, setHandedOver] = useState<{
    readonly for: string;
    readonly is: MateSetupHandOver | { readonly kind: "went" };
  }>();
  const handOverAnswerNow = handedOver?.for === failureKey ? handedOver.is : undefined;
  const sendVerdict = useAtomCommand(zeropsCommands.standUpHandOver, "stand-up verdict to agent");
  const handOver = useCallback(() => {
    if (environmentId === null || handOverAnswerNow?.kind === "sending") return;
    setHandedOver({ for: failureKey, is: { kind: "sending" } });
    void sendVerdict({ environmentId, input: {} }).then((result) => {
      setHandedOver({ for: failureKey, is: handOverAnswer(result) });
    });
  }, [environmentId, failureKey, handOverAnswerNow?.kind, sendVerdict]);
  return {
    awaited: awaitedHere,
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
    setupFailure:
      failure === null || handOverAnswerNow?.kind === "went"
        ? null
        : { key: failureKey, failure, handOver, answer: handOverAnswerNow },
  };
}

/**
 * Where a draft that waited on its person's stand-up hands over to (`mateStandUpHandOver`): the
 * Mate's main conversation once the ask made it, else null. Whether the draft opened before the
 * Mate had a conversation is read once, at the first render its Mate's conversations are read:
 * until then nothing is decided, and nothing hands over.
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
  const conversationsRead = useEnvironmentConversationsRead(environmentId);
  const { primary } = resolvePrimaryConversation(
    threads.filter((thread) => thread.environmentId === environmentId),
  );
  const openedAs = (): boolean | null => (conversationsRead ? primary === undefined : null);
  const [opened, setOpened] = useState(() => ({ key: draft?.key, beforeConversation: openedAs() }));
  if (opened.key !== draft?.key) {
    setOpened({ key: draft?.key, beforeConversation: openedAs() });
  } else if (opened.beforeConversation === null && conversationsRead) {
    setOpened({ key: draft?.key, beforeConversation: primary === undefined });
  }
  if (draft === null) return null;
  const whoLivesHere = zeropsMateAt(directory, draft.environmentId);
  if (whoLivesHere.kind !== "mate") return null;
  const threadId = mateStandUpHandOver({
    marker: whoLivesHere.mate.standUp,
    viewer,
    openedBeforeConversation: opened.beforeConversation === true,
    typed: draft.typed,
    main: primary,
  });
  return threadId === undefined ? null : scopeThreadRef(draft.environmentId, threadId);
}
