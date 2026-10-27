/**
 * The agent's availability where the person can act on the agent (S6): a dot on the control that
 * chooses or names it, named for a screen reader, and a note at the top of what that control
 * opens, saying why. A colleague's read-along footer and a held footer draw none: that viewer
 * cannot act on the agent.
 */
import { CircleAlertIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import type { ProviderAvailability } from "./providerAvailability.logic";

/** What a control carrying the dot is named: its own name, then the status. */
export function availabilityName(name: string, availability: ProviderAvailability | null): string {
  return availability === null ? name : `${name}, ${availability.title}`;
}

/** The control's dot: the agent is not fully available, in the tone its status has. */
export function AvailabilityDot({
  availability,
  corner = false,
}: {
  readonly availability: ProviderAvailability;
  /** On an icon's top-right corner, rather than in the line. */
  readonly corner?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={availability.title}
      data-tone={availability.tone}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        corner
          ? "absolute -top-0.5 -right-0.5 ring-2 ring-(--contrast-input)"
          : "me-2 inline-block align-middle",
        availability.tone === "error" ? "bg-status-failed" : "bg-status-attention",
      )}
    />
  );
}

/**
 * What the dot means, at the top of what its control opens, and the way to fix it. Static
 * content: the control's name already carries the status, so it is not announced again.
 */
export function AvailabilityNote({
  availability,
  onOpenSetup,
  children,
}: {
  readonly availability: ProviderAvailability;
  readonly onOpenSetup: (() => void) | null;
  /** The control's own way on, under the note's (the crewmate editor). */
  readonly children?: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2 text-xs leading-snug"
      data-agent-availability=""
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          availability.tone === "error" ? "bg-status-failed" : "bg-status-attention",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{availability.title}</p>
        {availability.message === null ? null : (
          <p className="text-muted-foreground">{availability.message}</p>
        )}
        {onOpenSetup === null ? null : (
          <InlineButton className="mt-0.5" onClick={onOpenSetup}>
            Open coding agent setup
          </InlineButton>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * The composer's control when no agent can run: why, in its name and in what it opens, and the way
 * to the agent's setup there.
 */
export function UnavailableAgentControl({
  availability,
  onOpenSetup,
}: {
  readonly availability: ProviderAvailability;
  readonly onOpenSetup: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              availability.message === null
                ? availability.title
                : `${availability.title}: ${availability.message}`
            }
            className="shrink-0"
            data-chat-provider-unavailable="true"
            size="sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <CircleAlertIcon className="size-4" />
        <span className="truncate">{availability.title}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" padding="none">
        <AvailabilityNote
          availability={availability}
          onOpenSetup={
            onOpenSetup === null
              ? null
              : () => {
                  setOpen(false);
                  onOpenSetup();
                }
          }
        />
      </PopoverPopup>
    </Popover>
  );
}
