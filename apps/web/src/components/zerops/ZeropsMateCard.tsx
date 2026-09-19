/**
 * A Mate, as a card on the projects screen: who you talk to in this project.
 *
 * The face in its colour wearing the state the conversation is in — that is
 * where the state is read, never from a word — the name with when it last did
 * something at the card's right edge, then what it is on, then its own last
 * words: the same three facts, in the same order, as its row in the left menu,
 * because they are the same Mate. While it is not connected that second line
 * says how long until it is ("Coming up. A few minutes.") or carries the one
 * verb that is a real decision ("Set up Mate") — never a status verb, because
 * the face is asleep for the whole boot and that is where the state is read.
 * Nothing about the environment: which Zerops project the Mate lives in and
 * what that project is tagged are the environment's facts, and a Mate is
 * always in a dev box anyway — the card is about somebody, not somewhere.
 * Clicking the Mate opens it: the name is the button and stretches over the
 * card, opening a connected Mate's conversation or connecting to a ready one
 * first; the menu sits above it.
 *
 * Structural: every word on the line and every verb is the caller's (R5).
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MateFace } from "./primitives";

/** A verb on a Mate's line or at an environment's end — "Set up Mate", "Try again". Blue acts. */
export function ZeropsMateVerb({
  label,
  onClick,
  disabled = false,
  description,
  ...rest
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /**
   * What the verb would actually do, in words — for a verb whose name says
   * the mechanism rather than the outcome. It becomes the button's accessible
   * name, so the answer is not hover-only: a keyboard reaches it too.
   */
  readonly description?: string | undefined;
}) {
  return (
    <button
      {...rest}
      aria-label={description === undefined ? undefined : `${label}: ${description}`}
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

/**
 * The card's surface, shared with a tool's card: the one white card on the
 * page, whatever stands in it. The height fits a name, a line and a snippet
 * whether or not the socket has answered yet: a card that grows when the
 * conversation lands would push every card below it down the page.
 */
const CARD_SURFACE_CLASS =
  "relative flex min-h-[4.5rem] w-full min-w-0 items-center gap-3 rounded-[var(--zerops-card-radius)] border border-border/60 bg-card py-2.5 ps-3 pe-2";

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
   * When it last did something, at the name's right edge — the way a
   * messenger dates its rows. Absent until there is something to date.
   */
  readonly time?: string | undefined;
  /**
   * The Mate's own last words, quoted under what it is on. Absent while the
   * person's message is the last thing said: the line above already says it.
   */
  readonly snippet?: string | undefined;
  /**
   * The muted "Server x.y.z" / "Server x.y.z · x.y.z+1 available" line
   * (`mateUpdateLine`), and the Update verb beside it when there is one —
   * the descriptor's `update` field, quietly, never a banner (spec-mate.md
   * §2.9).
   */
  readonly updateLine?: ReactNode;
  /**
   * What clicking the Mate does — opens its conversation, or connects to it.
   * Absent, the card is still: the line then carries whatever verb there is.
   */
  readonly onSelect?: (() => void) | undefined;
  /**
   * A trailing action always visible at the card's edge — a real button, not
   * a hover-only verb — for something the card wants said as more than a
   * line ("Start" on a stopped Mate). The menu, when there is one, sits
   * beside it.
   */
  readonly action?: ReactNode;
  readonly menu?: ReactNode;
  readonly busy?: boolean;
  readonly className?: string;
}

export function ZeropsMateCard({
  name,
  tint,
  face,
  line,
  time,
  snippet,
  updateLine,
  onSelect,
  action,
  menu,
  busy = false,
  className,
}: ZeropsMateCardProps) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn(
        CARD_SURFACE_CLASS,
        "group/card transition-[border-color,background-color,transform] duration-150 motion-reduce:transition-none",
        onSelect &&
          "hover:border-border hover:bg-accent/40 has-[[data-zerops-surface=mate-open]:active]:scale-[0.99]",
        className,
      )}
      data-zerops-mate-card={onSelect ? "opens" : "still"}
    >
      <MateFace size="md" state={face} tint={tint} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          {onSelect ? (
            <button
              className="min-w-0 flex-1 truncate rounded-sm text-left text-sm leading-5 font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[var(--zerops-card-radius)] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
              data-zerops-surface="mate-open"
              onClick={onSelect}
              type="button"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium text-foreground">
              {name}
            </span>
          )}
          {time === undefined || time.length === 0 ? null : (
            <span
              className="shrink-0 text-[11px] leading-5 text-muted-foreground tabular-nums"
              data-zerops-surface="mate-time"
            >
              {time}
            </span>
          )}
        </div>
        {line === undefined || line === null ? null : (
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
            data-zerops-surface="mate-line"
          >
            {line}
          </div>
        )}
        {snippet === undefined || snippet.length === 0 ? null : (
          <div
            className="min-w-0 truncate text-xs leading-4 text-muted-foreground"
            data-zerops-surface="mate-snippet"
          >
            {snippet}
          </div>
        )}
        {updateLine === undefined || updateLine === null ? null : (
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
            data-zerops-surface="mate-update-line"
          >
            {updateLine}
          </div>
        )}
      </div>
      {action === undefined || action === null ? null : (
        <span className="relative z-[1] flex shrink-0" data-zerops-surface="mate-action">
          {action}
        </span>
      )}
      {menu === undefined || menu === null ? null : (
        <span className="relative z-[1] flex shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </span>
      )}
    </div>
  );
}

export interface ZeropsToolCardProps {
  readonly name: string;
  /**
   * The tool's one line: where it is, once it is up, or how long until it
   * is. Absent, the name sits alone.
   */
  readonly line?: ReactNode;
  readonly menu?: ReactNode;
  readonly className?: string;
}

/**
 * An account-level tool (Gitea) on the projects screen, in the Mate card's
 * treatment: the same surface, radius and padding, so the page has one card
 * and not a card beside a bare line. No face, because a tool is nobody, and
 * not a way in: what it offers is on its line (its address) and in its menu.
 */
export function ZeropsToolCard({ name, line, menu, className }: ZeropsToolCardProps) {
  return (
    <div className={cn(CARD_SURFACE_CLASS, "group/card", className)} data-zerops-tool-card="true">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">
          {name}
        </span>
        {line === undefined || line === null ? null : (
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
            data-zerops-surface="tool-line"
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
