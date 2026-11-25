import { ArrowDownIcon } from "lucide-react";

import { FloatingAction } from "../ui/floating-action";

/**
 * The way back to the end, once the person has scrolled away from it: the kit's floating press
 * over the timeline. It stands beside the conversation's column, never on its words (Bodhi's
 * audit), and at its right edge where there is no room.
 */
export function ScrollToEndButton({
  showScrollToBottom,
  composerOverlayHeight,
  onJumpToLatest,
}: {
  showScrollToBottom: boolean;
  composerOverlayHeight: number;
  onJumpToLatest: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute z-30 flex justify-center py-2"
      style={{
        bottom: composerOverlayHeight + 4,
        left: "min(calc(50% + 24rem + 0.75rem), calc(100% - 3rem))",
      }}
    >
      <FloatingAction label="Scroll to end" onClick={onJumpToLatest} shown={showScrollToBottom}>
        <ArrowDownIcon aria-hidden="true" />
      </FloatingAction>
    </div>
  );
}
