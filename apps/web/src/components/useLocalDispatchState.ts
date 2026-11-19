import type { ApprovalRequestId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import type { ComposerSubmissionIntent } from "../composer-logic";
import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  latestTurnStartFailureId,
  type LocalDispatchSnapshot,
} from "./ChatView.logic";
import type { SessionPhase, Thread } from "../types";

export function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);
  const latestUserMessage = input.activeThread?.messages.findLast(
    (message) => message.role === "user",
  );
  const latestUserMessageId = latestUserMessage?.id ?? null;
  const currentTurnStartFailureId =
    localDispatch === null
      ? null
      : latestTurnStartFailureId(input.activeThread, latestUserMessageId);

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        latestUserMessageId,
        session: input.activeThread?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        latestTurnStartFailureId: currentTurnStartFailureId,
        threadError: input.threadError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.session,
      input.phase,
      input.threadError,
      latestUserMessageId,
      currentTurnStartFailureId,
      localDispatch,
    ],
  );
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean; submissionIntent?: ComposerSubmissionIntent }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        const active = serverAcknowledgedLocalDispatch ? null : current;
        if (active) {
          const submissionIntent = options?.submissionIntent ?? active.submissionIntent;
          return active.preparingWorktree === preparingWorktree &&
            active.submissionIntent === submissionIntent
            ? active
            : { ...active, preparingWorktree, submissionIntent };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread, serverAcknowledgedLocalDispatch],
  );

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    latestUserMessageAt: latestUserMessage?.createdAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: localDispatch?.submissionIntent === "background",
  };
}
