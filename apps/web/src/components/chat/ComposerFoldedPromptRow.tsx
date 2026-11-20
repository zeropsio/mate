import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { AvailabilityDot, availabilityName } from "./AgentAvailability";
import { COMPOSER_PROMPT_TYPE_CLASS_NAME } from "./composerTypography";
import type { ProviderAvailability } from "./providerAvailability.logic";

const collapsedComposerPrimaryActionLabel = "Send message";

export function ComposerFoldedPromptRow({
  words,
  placeholder,
  availability,
  onExpand,
  tasksBadge,
  stashBadge,
  sendDisabled,
  onSend,
}: {
  readonly words: string;
  readonly placeholder: string;
  readonly availability: ProviderAvailability | null;
  readonly onExpand: () => void;
  readonly tasksBadge: ReactNode;
  readonly stashBadge: ReactNode;
  readonly sendDisabled: boolean;
  readonly onSend: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <button
        type="button"
        // The editor's own type (16 px under a finger): opening it changes no letter's
        // size. It reaches the pill's top, bottom and left edge, so a finger anywhere
        // on the words' side opens it.
        className={cn(
          "-my-2 -ms-3 min-w-0 flex-1 self-stretch truncate bg-transparent py-2 ps-3 text-left focus:outline-none",
          COMPOSER_PROMPT_TYPE_CLASS_NAME,
          words ? "text-foreground" : "text-placeholder",
        )}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onExpand}
        aria-label={availabilityName("Expand composer", availability)}
      >
        {availability === null ? null : <AvailabilityDot availability={availability} />}
        {words || placeholder}
      </button>
      {tasksBadge}
      {stashBadge}
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-64"
        disabled={sendDisabled}
        data-composer-primary=""
        aria-label={collapsedComposerPrimaryActionLabel}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onSend();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 3L8 13M8 3L4 7M8 3L12 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
