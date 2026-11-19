import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ComposerFullScreenToggle({
  fullComposer,
  onToggle,
}: {
  readonly fullComposer: "on" | "leaving" | "off";
  readonly onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="composer-full-toggle"
            aria-label={fullComposer === "on" ? "Back to the conversation" : "Full screen"}
            aria-pressed={fullComposer === "on"}
            // The caret stays where it was in the text.
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggle}
          >
            {fullComposer === "on" ? (
              <Minimize2Icon aria-hidden="true" />
            ) : (
              <Maximize2Icon aria-hidden="true" />
            )}
          </button>
        }
      />
      <TooltipPopup side="top">
        {fullComposer === "on" ? "Back to the conversation (Esc)" : "Write in full screen"}
      </TooltipPopup>
    </Tooltip>
  );
}
