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
    // `.composer-full-toggle` places the press in the text's top corner and shows it with the
    // composer's hover or focus.
    <span className="composer-full-toggle">
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
        <TooltipPopup side="top">
          {fullComposer === "on" ? "Back to the conversation (Esc)" : "Write in full screen"}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
