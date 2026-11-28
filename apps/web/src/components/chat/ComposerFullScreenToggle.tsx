import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ComposerFullScreenToggle({
  fullComposer,
  onToggle,
}: {
  readonly fullComposer: "on" | "leaving" | "off";
  readonly onToggle: () => void;
}) {
  return (
    // In the text's top corner, shown with the composer's hover or focus (always on a screen
    // without hover), and while the composer is full screen.
    <span className="absolute -top-0.5 -right-1 z-1 grid size-6.5 place-items-center opacity-0 transition-opacity duration-150 ease-out-strong focus-within:opacity-100 in-data-[composer-full=on]:opacity-100 in-[[data-chat-composer-surface]:focus-within]:opacity-100 in-[[data-chat-composer-surface]:hover]:opacity-100 [@media(hover:none)]:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={fullComposer === "on" ? "Back to the conversation" : "Full screen"}
              aria-pressed={fullComposer === "on"}
              // The caret stays where it was in the text.
              onPointerDown={(event) => event.preventDefault()}
              onClick={onToggle}
              size="icon-xs"
              variant="ghost-muted"
            >
              {fullComposer === "on" ? (
                <Minimize2Icon aria-hidden="true" />
              ) : (
                <Maximize2Icon aria-hidden="true" />
              )}
            </Button>
          }
        />
        <TooltipPopup shortcut={fullComposer === "on" ? "Esc" : undefined} side="top">
          {fullComposer === "on" ? "Back to the conversation" : "Write in full screen"}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
