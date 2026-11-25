import { BookmarkIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * Bookmark control that shows the stash count and opens the stash menu. It
 * sits behind the composer's shoulder unless another drawer needs that space,
 * then moves into the composer's existing controls.
 *
 * On save the badge gives one quiet acknowledgement: it lifts to full
 * opacity and the count ticks over. `pulseKey` changes per stash, remounting
 * the count so the transition replays without a continuous animation.
 */
export const ComposerStashBadge = memo(function ComposerStashBadge(props: {
  count: number;
  menuOpen: boolean;
  placement?: "inline" | "tab";
  pulseKey: number;
  pulsing: boolean;
  onToggleMenu: () => void;
}) {
  if (props.count === 0) return null;
  const inline = props.placement === "inline";
  const count = (
    <span
      key={props.pulseKey}
      className={cn(
        "text-caption font-medium leading-none tabular-nums",
        props.pulsing
          ? "text-primary transition-[opacity,translate] duration-180 ease-out starting:translate-y-0.5 starting:opacity-0 motion-reduce:transition-none"
          : "text-muted-foreground",
      )}
    >
      {props.count}
    </span>
  );

  if (inline) {
    return (
      <Button
        size="sm"
        variant="ghost"
        data-prompt-stash-badge="true"
        aria-label={`Stashed prompts: ${props.count}. Open stash.`}
        aria-expanded={props.menuOpen}
        className="shrink-0"
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleMenu}
      >
        {/* Open or just saved, the bookmark takes the foreground ink beside the count. */}
        <BookmarkIcon
          className={
            props.menuOpen || props.pulsing ? "size-3 shrink-0 text-foreground" : "size-3 shrink-0"
          }
          aria-hidden="true"
        />
        {count}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "chat-composer-shoulder-tab absolute -top-7 right-4 z-0 flex h-8 items-center rounded-t-control border border-b-0 px-1 pb-1",
        props.menuOpen && "pointer-events-none",
      )}
    >
      <Button
        variant="ghost-muted"
        size="xs"
        data-prompt-stash-badge="true"
        aria-label={`Stashed prompts: ${props.count}. Open stash.`}
        aria-expanded={props.menuOpen}
        data-pressed={props.menuOpen || undefined}
        onPointerDown={(event) => {
          // Keep composer focus so Escape/typing flows stay intact.
          event.preventDefault();
        }}
        onClick={props.onToggleMenu}
      >
        <BookmarkIcon aria-hidden="true" />
        Stash
        {count}
      </Button>
    </div>
  );
});
