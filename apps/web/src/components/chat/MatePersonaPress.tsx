/**
 * The Mate's persona on its chat's line: its name, quiet, after the Mate's own; a press opens the
 * Persona page. Nothing while the Mate has none.
 */
import { Drama as PersonaIcon } from "lucide-react";
import { useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function MatePersonaPress(props: {
  readonly mateName: string;
  readonly persona: string | null;
  readonly onOpen: () => void;
}) {
  // Arriving after the line stands (its settings read late), it fades in where it stays.
  const present = props.persona !== null;
  const [seen, setSeen] = useState({ present, arrived: false });
  if (seen.present !== present) setSeen({ present, arrived: present });
  if (props.persona === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`${props.mateName}'s persona: ${props.persona}`}
            className="conversation-persona flex h-6 min-w-0 max-w-36 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            data-arrived={seen.arrived ? "" : undefined}
            data-conversation-persona=""
            onClick={props.onOpen}
            type="button"
          />
        }
      >
        <PersonaIcon aria-hidden="true" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{props.persona}</span>
      </TooltipTrigger>
      <TooltipPopup align="start" side="bottom">
        {`How ${props.mateName} works and talks in every chat.`}
      </TooltipPopup>
    </Tooltip>
  );
}
