/**
 * The agent's availability where the person can act on the agent (S6): a dot on the control that
 * chooses or names it, named for a screen reader, and a note at the top of what that control
 * opens, saying why. A colleague's read-along footer and a held footer draw none: that viewer
 * cannot act on the agent.
 */
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../ui/badge";
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
  const tone = availability.tone === "error" ? "danger" : "warning";
  if (!corner)
    return <Badge aria-label={availability.title} className="me-2 align-middle" dot tone={tone} />;
  // On an icon's top-right corner, ringed by the control's ground: a mark on a thing, not a label.
  return (
    <span className="absolute -top-1 -right-1 flex rounded-full ring-2 ring-(--contrast-input)">
      <Badge aria-label={availability.title} dot tone={tone} />
    </span>
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
    <Alert
      className="shrink-0"
      data-agent-availability=""
      icon={
        availability.tone === "error" ? (
          <CircleAlertIcon aria-hidden="true" />
        ) : (
          <TriangleAlertIcon aria-hidden="true" />
        )
      }
      role="note"
      surface="band"
      variant={availability.tone === "error" ? "error" : "warning"}
    >
      <AlertTitle>{availability.title}</AlertTitle>
      {availability.message === null ? null : (
        <AlertDescription>{availability.message}</AlertDescription>
      )}
      {onOpenSetup === null ? null : (
        <p className="m-0 mt-0.5">
          <InlineButton onClick={onOpenSetup}>Open coding agent setup</InlineButton>
        </p>
      )}
      {children}
    </Alert>
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
