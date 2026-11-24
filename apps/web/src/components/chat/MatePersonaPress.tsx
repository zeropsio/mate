/**
 * The Mate's persona on its chat's line: its name, quiet, after the Mate's own; a press opens the
 * Persona page. The line fades it in when it arrives late (`ConversationStrip`).
 */
import { Drama as PersonaIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function MatePersonaPress(props: {
  readonly mateName: string;
  readonly persona: string;
  readonly onOpen: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`${props.mateName}'s persona: ${props.persona}`}
            className="min-w-0 max-w-36 shrink"
            data-conversation-persona=""
            onClick={props.onOpen}
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        <PersonaIcon aria-hidden="true" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{props.persona}</span>
      </TooltipTrigger>
      <TooltipPopup align="start" side="bottom">
        {`How ${props.mateName} works with you, and what it focuses on.`}
      </TooltipPopup>
    </Tooltip>
  );
}
