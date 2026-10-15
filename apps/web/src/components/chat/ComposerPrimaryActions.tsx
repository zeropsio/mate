import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
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
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  /** Work the turn started that runs on after it: its Stop stands here, the only one. */
  backgroundWork?: { readonly stopping: boolean; readonly onStop: () => void } | null;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

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

// The composer's labeled primary actions (Submit, Refine, Implement) share the send button's
// message-action pill, so they are composer-owned buttons rather than restyled Buttons.
const messageActionPillClassName =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

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
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  preserveComposerFocusOnPointerDown = false,
  backgroundWork = null,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const isSendDisabled = sendDisabledReason !== null;

  const renderStopGenerationButton = (
    insidePendingAction: boolean,
    stop: { label: string; onClick: () => void; disabled?: boolean } = {
      label: "Stop generation",
      onClick: onInterrupt,
    },
  ) => (
    <button
      type="button"
      disabled={stop.disabled}
      className={cn(
        // The run's own ink, not the alarm's: red is what a failure wears, and
        // a run the person may stop has not failed. Beside the blue send it
        // can never be mistaken for it.
        "flex cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-xs shadow-foreground/16 inset-shadow-2xs inset-shadow-white/16 transition-[scale,background-color,box-shadow] duration-150 ease-out hover:scale-105 hover:bg-foreground/88 active:scale-95 active:inset-shadow-black/8 active:shadow-none disabled:pointer-events-none disabled:opacity-64",
        insidePendingAction
          ? "size-8 sm:size-7"
          : hasSendableContent
            ? "size-9 sm:size-8"
            : "size-8 sm:h-8 sm:w-8",
      )}
      {...pointerFocusProps}
      onClick={stop.onClick}
      aria-label={stop.label}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {isRunning ? renderStopGenerationButton(true) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-md"
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
              size="md"
              variant="secondary"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <button
          type="submit"
          className={cn(messageActionPillClassName, "h-8 sm:h-7", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </button>
      </div>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <button
          type="submit"
          className={cn(messageActionPillClassName, "h-9 sm:h-8", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <button
          type="submit"
          className={cn(messageActionPillClassName, "h-9 rounded-r-none px-4 sm:h-8")}
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </button>
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  messageActionPillClassName,
                  "h-9 rounded-l-none border-l border-message-action-foreground/20 px-2 sm:h-8",
                )}
                aria-label="Implementation actions"
                {...pointerFocusProps}
                disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            <MenuItem
              disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              onClick={() => void onImplementPlanInNewThread()}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  // Blue is for what can be clicked (S3): with nothing to send the button is
  // the toolbar's neutral grey, and it turns blue the moment there is.
  const sendButtonItself = (
    <button
      type="submit"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs transition-[scale,background-color,box-shadow,opacity] duration-150 ease-out enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] enabled:shadow-message-action/24 hover:scale-105 hover:bg-message-action-hover active:scale-95 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:bg-foreground/9 disabled:text-muted-foreground disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8"
      {...pointerFocusProps}
      aria-description={sendHint ?? undefined}
      disabled={
        isSendBusy ||
        isSendDisabled ||
        isConnecting ||
        isEnvironmentUnavailable ||
        !hasSendableContent
      }
      aria-label={
        isEnvironmentUnavailable
          ? "Environment disconnected"
          : sendDisabledReason
            ? sendDisabledReason
            : isConnecting
              ? "Connecting"
              : isPreparingWorktree
                ? "Preparing worktree"
                : isSendBusy
                  ? "Sending"
                  : isRunning
                    ? "Queue message"
                    : "Send message"
      }
    >
      {isConnecting || isSendBusy ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
  // One Send, whether or not the Mate works in another chat: the hint comes and goes as its
  // description and its hover, and a focused Send keeps its focus as it does.
  const sendButton = (
    <Tooltip disabled={sendHint === null}>
      <TooltipTrigger render={sendButtonItself} />
      <TooltipPopup side="top">{sendHint}</TooltipPopup>
    </Tooltip>
  );

  if (!isRunning) {
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
      {renderStopGenerationButton(false)}
      {hasSendableContent ? sendButton : null}
    </>
  );
});
