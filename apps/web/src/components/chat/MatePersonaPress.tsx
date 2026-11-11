/**
 * The Mate's persona on its chat's line: its name, quiet, after the Mate's own; a press opens the
 * Persona page. The line fades it in when it arrives late (`ConversationStrip`).
 */
import { Drama as PersonaIcon } from "lucide-react";
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
          <button
            aria-label={`${props.mateName}'s persona: ${props.persona}`}
            className="flex h-6 min-w-0 max-w-36 shrink cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
        {`How ${props.mateName} works with you, and what it focuses on.`}
      </TooltipPopup>
    </Tooltip>
  );
}
