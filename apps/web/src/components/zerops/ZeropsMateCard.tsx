/**
 * A Mate, as a card on the projects screen: who you talk to in this project.
 *
 * The face in its colour wearing the state the conversation is in — that is
 * where the state is read, never from a word — the name, and one line under
 * it: what the Mate is on, or was last on, while it is connected; the one
 * verb that would change things ("Connect", "Set up Mate") or the sentence
 * about its container otherwise. Nothing about the environment: which Zerops
 * project the Mate lives in and what that project is tagged are the
 * environment's facts, and a Mate is always in a dev box anyway — the card is
 * about somebody, not somewhere. The card does what its line says: the name is
 * the button and stretches over the card, opening a connected Mate's
 * conversation or connecting to a ready one; the menu sits above it.
 *
 * Structural: every word on the line and every verb is the caller's (R5).
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MateFace } from "./primitives";

/** A verb on a Mate's line or at an environment's end — "Connect", "Set up Mate". Blue acts. */
export function ZeropsMateVerb({
  label,
  onClick,
  disabled = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      className="relative z-[1] shrink-0 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
      data-zerops-primary-action={label}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export interface ZeropsMateCardProps {
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
  /**
   * The line under the name: what the Mate is on or was last on, a
   * `ZeropsMateVerb`, or a sentence about its container. Absent, the name
   * sits alone — a Mate that has not been spoken to yet has nothing to say.
   */
  readonly line?: ReactNode;
  /**
   * What clicking the Mate does — opens its conversation, or connects to it.
   * Absent, the card is still: the line then carries whatever verb there is.
   */
  readonly onSelect?: (() => void) | undefined;
  readonly menu?: ReactNode;
  readonly busy?: boolean;
  readonly className?: string;
}

export function ZeropsMateCard({
  name,
  tint,
  face,
  line,
  onSelect,
  menu,
  busy = false,
  className,
}: ZeropsMateCardProps) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn(
        "group/card relative flex min-h-[3.75rem] w-full min-w-0 items-center gap-3 rounded-[var(--zerops-card-radius)] border border-border/60 bg-card py-2.5 ps-3 pe-2 transition-[border-color,background-color,transform] duration-150 motion-reduce:transition-none",
        onSelect &&
          "hover:border-border hover:bg-accent/40 has-[[data-zerops-surface=mate-open]:active]:scale-[0.99]",
        className,
      )}
      data-zerops-mate-card={onSelect ? "opens" : "still"}
    >
      <MateFace size="md" state={face} tint={tint} />
      <div className="flex min-w-0 flex-1 flex-col">
        {onSelect ? (
          <button
            className="min-w-0 truncate rounded-sm text-left text-sm leading-5 font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[var(--zerops-card-radius)] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
            data-zerops-surface="mate-open"
            onClick={onSelect}
            type="button"
          >
            {name}
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">
            {name}
          </span>
        )}
        {line === undefined || line === null ? null : (
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
            data-zerops-surface="mate-line"
          >
            {line}
          </div>
        )}
      </div>
      {menu === undefined || menu === null ? null : (
        <span className="relative z-[1] flex shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </span>
      )}
    </div>
  );
}
