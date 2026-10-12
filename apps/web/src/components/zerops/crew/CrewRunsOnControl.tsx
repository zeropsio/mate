/**
 * A crewmate chat's composer footer (PRD §2.3 *Runs on*): what the crewmate
 * runs on, read-only — its model and effort are its own, not this message's,
 * and the crew gate decides its permissions — and the way to change them, its
 * crewmate editor. While its agent is not fully available, it carries the
 * model control's dot, and opens on why before the way to its editor (S6).
 */
import { useState } from "react";

import { AvailabilityDot, AvailabilityNote, availabilityName } from "../../chat/AgentAvailability";
import type { ProviderAvailability } from "../../chat/providerAvailability.logic";
import { Button, InlineButton } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";

export function CrewRunsOnControl({
  label,
  onEdit,
  availability = null,
  onOpenSetup = null,
}: {
  /** `crewRunsOnWord`: "Runs on Claude Code · Haiku 4.5 · high". */
  readonly label: string;
  readonly onEdit: () => void;
  /** The crewmate's agent, when it is not fully available (`providerAvailability`). */
  readonly availability?: ProviderAvailability | null;
  readonly onOpenSetup?: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const name = `${label} — edit in the crewmate editor`;
  if (availability === null) {
    return (
      <Button
        aria-label={name}
        className="-ms-2.5 min-w-0"
        data-crew-runs-on
        onClick={onEdit}
        size="xs"
        variant="ghost-muted"
      >
        <span className="truncate">{label}</span>
      </Button>
    );
  }
  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label={availabilityName(label, availability)}
            className="-ms-2.5 min-w-0"
            data-crew-runs-on
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        <AvailabilityDot availability={availability} />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" padding="none">
        <AvailabilityNote
          availability={availability}
          onOpenSetup={onOpenSetup === null ? null : close(onOpenSetup)}
        >
          <InlineButton className="mt-0.5 block" onClick={close(onEdit)}>
            Edit in the crewmate editor
          </InlineButton>
        </AvailabilityNote>
      </PopoverPopup>
    </Popover>
  );
}
