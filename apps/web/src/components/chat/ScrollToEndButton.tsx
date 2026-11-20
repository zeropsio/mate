import { ArrowDownIcon } from "lucide-react";

/**
 * The way back to the end, once the person has scrolled away from
 * it: a round button floating over the timeline, always drawn and
 * eased in and out, so it rises into place instead of popping. It
 * stands beside the conversation's column, never on its words
 * (Bodhi's audit), and at its right edge where there is no room.
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
      {/* Hidden, it is inert: out of the tab order and the tree the
          reader hears, and a button still focused as it goes (a click
          or a key focused it) lets the focus go with it. */}
      <button
        aria-label="Scroll to end"
        className="pointer-events-auto relative flex size-8 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-popover text-foreground shadow-lg/8 transition-[opacity,translate,scale,background-color] duration-200 ease-out hover:bg-accent active:scale-95 not-data-shown:pointer-events-none not-data-shown:translate-y-1.5 not-data-shown:scale-96 not-data-shown:opacity-0 pointer-coarse:after:absolute pointer-coarse:after:size-11"
        data-shown={showScrollToBottom ? "" : undefined}
        inert={!showScrollToBottom}
        onClick={onJumpToLatest}
        type="button"
      >
        <ArrowDownIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
