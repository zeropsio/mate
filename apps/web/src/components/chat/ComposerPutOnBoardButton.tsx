import { SquareKanbanIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Put on board, beside the composer's other tools: the draft goes as `/board <words>`, asking the
 * agent to propose it for the application's Board instead of doing it now. Send stays one press.
 */
export function ComposerPutOnBoardButton({
  disabled,
  onPress,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Put on board"
            data-chat-composer-board=""
            disabled={disabled}
            // The caret stays where it was in the text.
            onPointerDown={(event) => event.preventDefault()}
            onClick={onPress}
          >
            <SquareKanbanIcon aria-hidden="true" />
          </Button>
        }
      />
      <TooltipPopup side="top">Put on board</TooltipPopup>
    </Tooltip>
  );
}
