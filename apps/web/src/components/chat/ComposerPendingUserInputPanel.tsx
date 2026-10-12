import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

import { ComposerAsk, ComposerAskMark } from "./ComposerAsk";

/**
 * What a keystroke means for the option list, or undefined when the card should
 * not claim the key.
 *
 * Exported and pure so the rules are tested directly: this card is rendered by
 * `renderToStaticMarkup` in tests, which cannot press a key.
 */
export function pendingUserInputKeyAction(
  key: string,
  optionCount: number,
  highlightedIndex: number,
): { readonly type: "move" | "select"; readonly index: number } | undefined {
  if (optionCount <= 0) {
    return undefined;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    return {
      type: "move",
      index: highlightedIndex < 0 ? 0 : (highlightedIndex + step + optionCount) % optionCount,
    };
  }
  if (key === "Enter") {
    // Enter with nothing highlighted belongs to the composer — that is how a
    // free-text answer is sent. Only claim it once the cursor is on an option.
    return highlightedIndex >= 0 && highlightedIndex < optionCount
      ? { type: "select", index: highlightedIndex }
      : undefined;
  }
  const digit = Number.parseInt(key, 10);
  if (Number.isNaN(digit) || digit < 1 || digit > 9 || digit > optionCount) {
    return undefined;
  }
  return { type: "select", index: digit - 1 };
}

interface PendingUserInputPanelBaseProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  /** The asking Mate's face (`ComposerAskFace`); a plain agent's mark without one. */
  face?: ReactNode;
  /** Who asks, by name. */
  who?: string;
}

/** What answering the card does. A read-only card has none of it. */
interface PendingUserInputAnswerHandlers {
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: ApprovalRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  face,
  who,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelBaseProps & PendingUserInputAnswerHandlers) {
  const answer = useMemo(
    () => ({ onToggleOption, onAdvance, onDismiss }),
    [onAdvance, onDismiss, onToggleOption],
  );
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      waitingLabel="Waiting for you"
      face={face}
      who={who}
      answer={answer}
    />
  );
});

/**
 * The same card for a viewer who may not answer it — a question on someone
 * else's agent (D6). It shows the question and its options and says whom it
 * waits on; nothing on it is a control but the disclosure toggle, and no key
 * answers it.
 */
export const ComposerPendingUserInputReadOnlyPanel = memo(
  function ComposerPendingUserInputReadOnlyPanel({
    pendingUserInputs,
    waitingLabel,
    face,
    who,
  }: {
    pendingUserInputs: PendingUserInput[];
    waitingLabel: string;
    face?: ReactNode;
    who?: string;
  }) {
    const activePrompt = pendingUserInputs[0];
    if (!activePrompt) return null;

    // A reader drafts no answers, so the card shows the first question as asked.
    return (
      <ComposerPendingUserInputCard
        key={activePrompt.requestId}
        prompt={activePrompt}
        isResponding={false}
        answers={NO_DRAFT_ANSWERS}
        questionIndex={0}
        waitingLabel={waitingLabel}
        face={face}
        who={who}
        answer={null}
      />
    );
  },
);

const NO_DRAFT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  waitingLabel,
  face,
  who = "The agent",
  answer,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  waitingLabel: string;
  face?: ReactNode | undefined;
  who?: string | undefined;
  answer: PendingUserInputAnswerHandlers | null;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(answer?.onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  // Collapsing hides everything but the header so a tall prompt stops covering
  // the thread the user is trying to read. Scoped to a single question: the card
  // is keyed by request id so the next prompt starts expanded, and storing the
  // collapsed question's id (rather than a bare flag) reopens the card when the
  // prompt advances to its next question, which can happen without a click —
  // sending from the composer advances the active question.
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;
  // Arrow-key cursor. The digit shortcuts below cover the first nine options
  // and need no cursor; this is for reaching the rest, and for anyone who
  // reads down a list rather than counting it. -1 means "nothing highlighted",
  // which is the state every question starts in — highlighting the first
  // option by default would suggest a pre-made choice.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    onAdvanceRef.current = answer?.onAdvance;
  }, [answer]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionValues,
  ]);

  // A new question starts with nothing highlighted, so a cursor left on
  // option 3 cannot silently point at a different question's option 3.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [activeQuestion?.id]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useCallback(
    (questionId: string, optionValue: string) => {
      if (answer === null) return;
      if (activeQuestion?.multiSelect) {
        answer.onToggleOption(questionId, optionValue);
        return;
      }
      setOptimisticSingleSelect({ questionId, optionValue });
      answer.onToggleOption(questionId, optionValue);
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvanceRef.current?.();
      }, 200);
    },
    [activeQuestion, answer],
  );

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior. Collapsed prompts opt
  // out, since the numbers they refer to are not on screen; a read-only card
  // claims no key at all.
  useEffect(() => {
    if (answer === null || !activeQuestion || isResponding || isCollapsed) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const action = pendingUserInputKeyAction(
        event.key,
        activeQuestion.options.length,
        highlightedIndex,
      );
      if (action === undefined) return;
      event.preventDefault();
      if (action.type === "move") {
        setHighlightedIndex(action.index);
        return;
      }
      const option = activeQuestion.options[action.index];
      if (!option) return;
      handleOptionSelection(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [answer, activeQuestion, handleOptionSelection, highlightedIndex, isCollapsed, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  const customAnswerActive = progress.customAnswer.trim().length > 0;

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      <ComposerAsk
        actions={
          answer === null ? (
            <span className="text-line text-muted-foreground" data-pending-user-input-waiting>
              {waitingLabel}
            </span>
          ) : prompt.dismissible ? (
            // Dismiss closes an async question without sending a reply.
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label="Dismiss question without answering"
                    className="composer-top-dismiss"
                    data-pending-user-input-dismiss
                    disabled={isResponding}
                    onClick={() => answer.onDismiss(prompt.requestId)}
                    type="button"
                  >
                    <XIcon aria-hidden="true" />
                  </button>
                }
              />
              <TooltipPopup side="top">Dismiss without answering</TooltipPopup>
            </Tooltip>
          ) : undefined
        }
        detail={
          // The question itself, to be read whole; folded, its first line stands for it.
          <span className={cn("block text-foreground/85", isCollapsed && "truncate")}>
            {activeQuestion.question}
          </span>
        }
        face={face ?? <ComposerAskMark />}
        kind="question"
        label={`${who} asks: ${activeQuestion.header}`}
        title={
          // The head folds the options away, so a tall question stops covering the conversation.
          <CollapsibleTrigger
            title={
              isCollapsed
                ? "Show the question and its options"
                : "Hide the question and its options"
            }
            data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
            className="group -mx-1 inline-flex max-w-full items-center gap-1.5 rounded-sm px-1 align-bottom outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate">
              <span data-pending-request-kind="question">{`${who} asks`}</span>
              <span className="font-normal text-muted-foreground">
                {" · "}
                {activeQuestion.header}
              </span>
              {prompt.questions.length > 1 ? (
                <span
                  className="font-normal text-muted-foreground tabular-nums"
                  data-pending-request-progress={`${questionIndex + 1}/${prompt.questions.length}`}
                >
                  {` · ${questionIndex + 1} of ${prompt.questions.length}`}
                </span>
              ) : null}
              {/* Whom it waits on: the face's needs pose says it is the viewer; someone else is
                  named where the dismiss would stand. */}
              {answer === null ? null : (
                <span className="sr-only" data-pending-user-input-waiting>
                  {waitingLabel}
                </span>
              )}
            </span>
            {/* The chevron points at the options: down while they are open below, up folded. */}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground",
                isCollapsed && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
        }
      >
        {/* The options' text lines up with the question's: each option's own inset is paid
            back to the left, and the panel's pixel keeps their focus rings from being shaved
            while its height animates. */}
        <CollapsiblePanel className="-ms-[11px]">
          <div className="p-px">
            {activeQuestion.multiSelect ? (
              <p className="ps-2.5 pb-1 text-secondary-label text-xs">
                Select one or more options.
              </p>
            ) : null}
            <div className="space-y-0.5">
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const isOptimisticallySelected =
                  optimisticSingleSelect?.questionId === activeQuestion.id &&
                  optimisticSingleSelect.optionValue === optionValue;
                const isSelected =
                  isOptimisticallySelected ||
                  (!customAnswerActive && progress.selectedOptionValues.includes(optionValue));
                const isHighlighted = index === highlightedIndex;
                if (answer === null) {
                  return (
                    <div
                      key={`${activeQuestion.id}:${optionValue}`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left",
                        isSelected ? "bg-muted/55 text-foreground" : "text-foreground/85",
                      )}
                    >
                      <PendingUserInputOptionLabel option={option} />
                      {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : null}
                    </div>
                  );
                }
                const shortcutKey = index < 9 ? index + 1 : null;
                const className = cn(
                  "group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-primary/25",
                  isSelected
                    ? "bg-muted/55 text-foreground"
                    : "bg-transparent text-foreground/85 hover:bg-muted/30",
                  isHighlighted && "ring-1 ring-primary/40",
                  isResponding && "opacity-50 cursor-not-allowed",
                  !isResponding && "cursor-pointer",
                );
                const content = (
                  <>
                    <PendingUserInputOptionLabel option={option} />
                    {isSelected ? (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    ) : shortcutKey !== null ? (
                      <kbd
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center text-xs font-medium text-muted-foreground tabular-nums",
                        )}
                      >
                        {shortcutKey}
                      </kbd>
                    ) : null}
                  </>
                );
                return (
                  <button
                    key={`${activeQuestion.id}:${optionValue}`}
                    type="button"
                    aria-current={isHighlighted ? "true" : undefined}
                    disabled={isResponding}
                    onClick={() => {
                      handleOptionSelection(activeQuestion.id, optionValue);
                    }}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
            {answer === null ? null : (
              /*
            Free text already worked — typing in the composer answers the
            question and overrides any selected option — but nothing on screen
            said so, so it was reachable only by knowing. This is that
            affordance, and it doubles as the read-back of what was typed.
          */
              <div
                className={cn(
                  "mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-left",
                  customAnswerActive ? "bg-muted/55 text-foreground" : "text-secondary-label",
                )}
                data-pending-user-input-other={customAnswerActive ? "answered" : "empty"}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium text-sm">Other</span>
                  <span className="text-line">
                    {customAnswerActive
                      ? progress.customAnswer
                      : "Type your own answer in the composer below."}
                  </span>
                </div>
                {customAnswerActive ? (
                  <CheckIcon className="size-3.5 shrink-0 text-primary" />
                ) : null}
              </div>
            )}
          </div>
        </CollapsiblePanel>
      </ComposerAsk>
    </Collapsible>
  );
});

function PendingUserInputOptionLabel({
  option,
}: {
  option: PendingUserInput["questions"][number]["options"][number];
}) {
  return (
    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
      <span className="text-sm font-medium">{option.label}</span>
      {option.description && option.description !== option.label ? (
        <span className="text-secondary-label text-line">{option.description}</span>
      ) : null}
    </div>
  );
}
