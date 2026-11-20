import { useCallback, useEffect, useRef, useState } from "react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { PendingUserInput } from "@t3tools/client-runtime/pending-requests";

import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import { readQuestionDraft, writeQuestionDraft } from "../../zerops/draftStorage";

/**
 * One conversation's half-answer to the agent's open question, kept in this browser under the
 * signed-in account: the part the person was on and the picks made. Attachment counts are not
 * kept; `useActivePendingUserInputProgress` derives them from the files in memory.
 */
const QuestionDraft = Schema.Struct({
  requestId: Schema.String,
  questionIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  answers: Schema.Record(
    Schema.String,
    Schema.Struct({
      selectedOptionValues: Schema.optionalKey(Schema.Array(Schema.String)),
      customAnswer: Schema.optionalKey(Schema.String),
    }),
  ),
});
const decodeQuestionDraft = Schema.decodeUnknownOption(QuestionDraft);

function storedDraft(environmentId: string, threadId: string) {
  return Option.getOrNull(decodeQuestionDraft(readQuestionDraft(environmentId, threadId)));
}

function keptAnswers(
  answers: Readonly<
    Record<
      string,
      { readonly selectedOptionValues?: ReadonlyArray<string>; readonly customAnswer?: string }
    >
  >,
): Record<string, PendingUserInputDraftAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, { selectedOptionValues, customAnswer }]) => [
      questionId,
      {
        ...(selectedOptionValues === undefined
          ? {}
          : { selectedOptionValues: [...selectedOptionValues] }),
        ...(customAnswer === undefined ? {} : { customAnswer }),
      },
    ]),
  );
}

/**
 * How far the person answered each open question (`ConversationView`): the answers and the part
 * shown, by request. A reload while the question stands returns both from the conversation's kept
 * record; `forget` drops it once the answer or dismissal landed.
 */
export function usePendingUserInputDraft({
  environmentId,
  threadId,
  activePendingUserInput,
}: {
  environmentId: string;
  threadId: string;
  activePendingUserInput: PendingUserInput | null;
}) {
  const [answersByRequestId, setAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [questionIndexByRequestId, setQuestionIndexByRequestId] = useState<Record<string, number>>(
    {},
  );
  const requestId = activePendingUserInput?.requestId ?? null;
  const draftScope = requestId === null ? null : `${environmentId}:${threadId}:${requestId}`;

  // The kept record seeds a question the person has not touched here yet, during the render that
  // first shows it, so the card never paints part 1 before jumping to the part they were on.
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  if (draftScope !== restoredScope) {
    setRestoredScope(draftScope);
    if (
      requestId !== null &&
      answersByRequestId[requestId] === undefined &&
      questionIndexByRequestId[requestId] === undefined
    ) {
      const stored = storedDraft(environmentId, threadId);
      if (stored !== null && stored.requestId === requestId) {
        setAnswersByRequestId((existing) => ({
          ...existing,
          [requestId]: keptAnswers(stored.answers),
        }));
        setQuestionIndexByRequestId((existing) => ({
          ...existing,
          [requestId]: stored.questionIndex,
        }));
      }
    }
  }

  // A request whose answer or dismissal landed is never written again, even while its card lingers
  // until the Mate's record of it arrives.
  const forgottenRequestIds = useRef(new Set<string>());
  const answers = requestId === null ? undefined : answersByRequestId[requestId];
  const questionIndex = requestId === null ? undefined : questionIndexByRequestId[requestId];
  useEffect(() => {
    if (requestId === null || forgottenRequestIds.current.has(requestId)) return;
    // An untouched question writes nothing, so it never replaces a kept record.
    if (answers === undefined && questionIndex === undefined) return;
    writeQuestionDraft(environmentId, threadId, {
      requestId,
      questionIndex: questionIndex ?? 0,
      answers: keptAnswers(answers ?? {}),
    });
  }, [answers, environmentId, questionIndex, requestId, threadId]);

  const forget = useCallback(
    (answeredRequestId: string) => {
      forgottenRequestIds.current.add(answeredRequestId);
      if (storedDraft(environmentId, threadId)?.requestId === answeredRequestId) {
        writeQuestionDraft(environmentId, threadId, null);
      }
    },
    [environmentId, threadId],
  );

  return {
    pendingUserInputAnswersByRequestId: answersByRequestId,
    setPendingUserInputAnswersByRequestId: setAnswersByRequestId,
    pendingUserInputQuestionIndexByRequestId: questionIndexByRequestId,
    setPendingUserInputQuestionIndexByRequestId: setQuestionIndexByRequestId,
    forget,
  };
}
