import {
  answerHeld,
  footerPrimary,
  type sendAway,
  sendHeld,
  sendSays,
} from "@t3tools/client-runtime/zerops/composer/footerActions";
import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Group } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  /** What Send's hover says before it sends: the Mate at work in another chat on the same files. */
  sendHint?: string | null;
  isConnecting: boolean;
  /** What is away so that Send cannot go (`sendAway`); null when nothing is. */
  away: ReturnType<typeof sendAway>;
  /** The away agent's name, when the conversation asked for one this Mate knows. */
  unavailableAgentName: string | null;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  /** Work the turn started that runs on after it: its Stop stands here, the only one. */
  backgroundWork?: { readonly stopping: boolean; readonly onStop: () => void } | null;
  /**
   * A person's Stop is in force (`conversationStop`): the running turn's Stop says so; a press
   * again asks harder (the engine closes the session).
   */
  stopping?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

const sendLabels = {
  environment: () => ({ label: "Environment disconnected" }),
  project: () => ({ label: "Choose a project" }),
  "agent-pending": () => ({ label: "Connecting" }),
  agent: (agentName) => ({
    label: agentName ? `${agentName} is unavailable` : "No provider available",
  }),
  connecting: () => ({ label: "Connecting" }),
  preparing: () => ({ label: "Preparing worktree" }),
  sending: () => ({ label: "Sending" }),
  queue: () => ({ label: "Queue message" }),
  send: () => ({ label: "Send message" }),
} satisfies Record<ReturnType<typeof sendSays>, (agentName: string | null) => { label: string }>;

const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  sendDisabledReason,
  sendHint = null,
  isConnecting,
  away,
  unavailableAgentName,
  isPreparingWorktree,
  hasSendableContent,
  preserveComposerFocusOnPointerDown = false,
  backgroundWork = null,
  stopping = false,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const isSendDisabled = sendDisabledReason !== null;
  const primary = footerPrimary({
    answering: pendingAction !== null,
    planFollowUp: showPlanFollowUpPrompt,
    draftHasWords: promptHasText,
    running: isRunning,
    sendable: hasSendableContent,
  });
  const held = sendHeld({
    busy: isSendBusy,
    blocked: isSendDisabled,
    connecting: isConnecting,
    unavailable: away !== null,
  });

  const renderStopGenerationButton = (
    insidePendingAction: boolean,
    stop: { label: string; onClick: () => void; disabled?: boolean } = {
      label: "Stop generation",
      onClick: onInterrupt,
    },
  ) => (
    // The run's own ink, not the alarm's: red is what a failure wears, and a run the person may
    // stop has not failed. Beside the blue send it can never be mistaken for it.
    <Button
      aria-label={stop.label}
      data-composer-primary=""
      disabled={stop.disabled}
      onClick={stop.onClick}
      shape="round"
      size={insidePendingAction ? "icon-sm" : "icon-md"}
      variant="primary"
      {...pointerFocusProps}
    >
      <svg aria-hidden="true" className="size-3" fill="currentColor" viewBox="0 0 12 12">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </Button>
  );

  if (primary === "answer" && pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {isRunning ? renderStopGenerationButton(true) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="secondary"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          variant="send"
          shape="round"
          size="sm"
          className="h-8 sm:h-7"
          {...pointerFocusProps}
          disabled={answerHeld({
            unavailable: away !== null,
            responding: pendingAction.isResponding,
            lastQuestion: pendingAction.isLastQuestion,
            complete: pendingAction.isComplete,
            canAdvance: pendingAction.canAdvance,
          })}
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (primary === "refine") {
    return (
      <Button
        type="submit"
        variant="send"
        shape="round"
        className="h-9 sm:h-8"
        {...pointerFocusProps}
        disabled={held}
      >
        {isConnecting || isSendBusy ? "Sending..." : "Refine"}
      </Button>
    );
  }

  if (primary === "implement") {
    return (
      <Group data-chat-composer-implement-actions="true">
        <Button
          type="submit"
          variant="send"
          shape="round"
          className="h-9 sm:h-8"
          {...pointerFocusProps}
          disabled={held}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="send"
                shape="round"
                size="icon-md"
                className="h-9 sm:h-8"
                aria-label="Implementation actions"
                {...pointerFocusProps}
                disabled={held}
              />
            }
          >
            {/* The seam between the pill's two presses, in the pill's own ink. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 start-0 w-px bg-message-action-foreground/20"
            />
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            <MenuItem disabled={held} onClick={() => void onImplementPlanInNewThread()}>
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </Group>
    );
  }

  // Blue is for what can be clicked (S3): with nothing to send the button is
  // the toolbar's neutral grey, and it turns blue the moment there is.
  const sendButtonItself = (
    <Button
      type="submit"
      variant="send"
      shape="round"
      size="icon-md"
      className="size-9 hover:scale-105 active:scale-95 sm:size-8"
      {...pointerFocusProps}
      data-composer-primary=""
      aria-description={sendHint ?? undefined}
      disabled={held || !hasSendableContent}
      aria-label={
        sendDisabledReason
          ? sendDisabledReason
          : sendLabels[
              sendSays({
                away,
                connecting: isConnecting,
                preparing: isPreparingWorktree,
                busy: isSendBusy,
                running: isRunning,
              })
            ](unavailableAgentName).label
      }
    >
      {isConnecting || isSendBusy ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : (
        <svg
          className="size-3.5"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Button>
  );
  // One Send, whether or not the Mate works in another chat: the hint comes and goes as its
  // description and its hover, and a focused Send keeps its focus as it does.
  const sendButton = (
    <Tooltip disabled={sendHint === null}>
      <TooltipTrigger render={sendButtonItself} />
      <TooltipPopup side="top">{sendHint}</TooltipPopup>
    </Tooltip>
  );

  if (primary === "send") {
    if (backgroundWork === null) {
      return sendButton;
    }
    return (
      <>
        {renderStopGenerationButton(false, {
          label: backgroundWork.stopping ? "Stopping background work" : "Stop background work",
          onClick: backgroundWork.onStop,
          disabled: backgroundWork.stopping,
        })}
        {sendButton}
      </>
    );
  }

  // While a turn runs, a sendable draft queues for the next tool boundary, so
  // the send button stays next to Stop on every viewport.
  return (
    <>
      {renderStopGenerationButton(
        false,
        stopping ? { label: "Stopping…", onClick: onInterrupt } : undefined,
      )}
      {primary === "stop-and-send" ? sendButton : null}
    </>
  );
});
