import { useMemo } from "react";
import type { ApprovalRequestId } from "@t3tools/contracts";
import type { PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import type { useQuestionAttachments } from "./chat/useQuestionAttachments";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

/** How far the person has answered the agent's open question: what its card shows (`ConversationView`). */
export function useActivePendingUserInputProgress({
  activePendingUserInput,
  pendingUserInputAnswersByRequestId,
  pendingUserInputQuestionIndexByRequestId,
  respondingUserInputRequestIds,
  questionAttachments,
}: {
  activePendingUserInput: PendingUserInput | null;
  pendingUserInputAnswersByRequestId: Record<string, Record<string, PendingUserInputDraftAnswer>>;
  pendingUserInputQuestionIndexByRequestId: Record<string, number>;
  respondingUserInputRequestIds: ApprovalRequestId[];
  questionAttachments: ReturnType<typeof useQuestionAttachments>;
}) {
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? Object.fromEntries(
            activePendingUserInput.questions.map((question) => [
              question.id,
              {
                ...pendingUserInputAnswersByRequestId[activePendingUserInput.requestId]?.[
                  question.id
                ],
                attachmentCount: questionAttachments.entries.filter(
                  (entry) => entry.questionId === question.id,
                ).length,
                attachmentsBlocked: questionAttachments.blocked,
              },
            ]),
          )
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [
      activePendingUserInput,
      pendingUserInputAnswersByRequestId,
      questionAttachments.entries,
      questionAttachments.blocked,
    ],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  return {
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
  };
}
