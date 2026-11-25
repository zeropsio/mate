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
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ExternalLinkIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { Button, InlineButton } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { MateFace } from "./primitives";
import { Text } from "~/components/ui/text";

/** Where a Mate's change runs before its pull request: its pair's stage, opened in a tab. */
function PreviewLink({ url }: { readonly url: string }) {
  return (
    <span className="relative z-[1] text-caption">
      <InlineButton
        data-zerops-surface="mate-preview"
        render={<a href={url} rel="noreferrer" target="_blank" />}
      >
        <ExternalLinkIcon aria-hidden="true" className="size-3" />
        Preview
      </InlineButton>
    </span>
  );
}

/** A verb on a Mate's line or at an environment's end — "Set up Mate", "Try again". */
export function ZeropsMateVerb({
  label,
  onClick,
  disabled = false,
  description,
  action,
  ...rest
}: {
  readonly label: string;
  /**
   * What the press does, where the label says something else — a refusal
   * whose words are the way to hand it over reads `needs a rebase` and acts
   * as *Ask*. Defaults to the label.
   */
  readonly action?: string | undefined;
  /** The press, with what was pressed: a review opens from it (pass 16, R7). */
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly disabled?: boolean;
  /**
   * What the verb would actually do, in words — for a verb whose name says
   * the mechanism rather than the outcome. It becomes the button's accessible
   * name, so the answer is not hover-only: a keyboard reaches it too.
   */
  readonly description?: string | undefined;
}) {
  return (
    <Button
      {...rest}
      aria-label={description === undefined ? undefined : `${label}: ${description}`}
      // Above the card's stretched name, which covers the card to open it.
      className="z-[1]"
      data-zerops-primary-action={action ?? label}
      disabled={disabled}
      onClick={onClick}
      size="xs"
      variant="secondary"
    >
      {label}
    </Button>
  );
}

/**
 * The card's inside: the surface is the kit's flat Card around it. The height
 * fits a name, a line and a snippet whether or not the socket has answered
 * yet: a card that grows when the conversation lands would push every card
 * below it down the page.
 */
const CARD_SURFACE_CLASS =
  "relative flex min-h-18 w-full min-w-0 items-center gap-3 rounded-card py-2.5 ps-3 pe-2";

/**
 * The row: the Mate as one entry of a list inside another surface (a project
 * card's Mates step), so it has none of its own — no border, no card, no
 * reserved height.
 */
const ROW_SURFACE_CLASS =
  "relative -mx-1.5 flex min-w-0 items-center gap-2.5 rounded-control px-1.5 py-1";

const LAYOUT = {
  card: {
    surface: CARD_SURFACE_CLASS,
    opens: "hover:bg-accent/40",
    lineOne: "",
    name: "",
    time: "",
  },
  row: {
    surface: ROW_SURFACE_CLASS,
    opens: "hover:bg-accent/60",
    // A row sits in a narrow step: the name never gives way, and its time and
    // Preview follow it — wrapping under it rather than cutting it to an
    // initial — with or without a Preview, at every width.
    lineOne: "flex-wrap gap-y-0",
    name: "max-w-full flex-none",
    time: "",
  },
} as const;

interface ZeropsMateCardProps {
  /**
   * `card`, the default: the Mate's own surface. `row`: an entry in a list on
   * another surface, its Preview on the name's line and no quoted last words.
   */
  readonly layout?: "card" | "row";
  /** The Mate's running app, linked on the name's line — drawn in the row only. */
  readonly preview?: string | undefined;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape?: MateShapeId | undefined;
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
  layout = "card",
  preview,
  name,
  tint,
  shape,
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
  const body = (
    <div
      aria-busy={busy || undefined}
      className={cn(
        LAYOUT[layout].surface,
        "group/card transition-colors duration-150 motion-reduce:transition-none",
        onSelect && LAYOUT[layout].opens,
        className,
      )}
      data-zerops-mate-card={onSelect ? "opens" : "still"}
    >
      <MateFace shape={shape} size={24} state={face} tint={tint} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn("flex min-w-0 items-center gap-2", LAYOUT[layout].lineOne)}>
          {onSelect ? (
            <span className={cn("flex min-w-0 flex-1 text-body leading-5", LAYOUT[layout].name)}>
              {/* The name opens the Mate, and its press covers the card. */}
              <InlineButton
                className="max-w-full min-w-0 after:absolute after:inset-0"
                data-zerops-surface="mate-open"
                onClick={onSelect}
                tone="plain"
              >
                <span className="truncate">{name}</span>
              </InlineButton>
            </span>
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-body leading-5 font-medium text-foreground",
                LAYOUT[layout].name,
              )}
            >
              {name}
            </span>
          )}
          {time === undefined || time.length === 0 ? null : (
            <span
              className={cn(
                "shrink-0 text-2xs leading-5 text-muted-foreground tabular-nums",
                LAYOUT[layout].time,
              )}
              data-zerops-surface="mate-time"
            >
              {time}
            </span>
          )}
          {layout === "row" && preview !== undefined ? <PreviewLink url={preview} /> : null}
          {/* A row's menu ends the name's line, so the line under it runs the row's width. */}
          {layout === "row" ? <CardMenu className="-my-1 ms-auto" menu={menu} /> : null}
        </div>
        {line === undefined || line === null ? null : (
          <Text
            className="flex min-w-0 items-center gap-1.5"
            render={<div />}
            variant="note"
            data-zerops-surface="mate-line"
          >
            {line}
          </Text>
        )}
        {layout === "row" || snippet === undefined || snippet.length === 0 ? null : (
          <Text
            className="min-w-0"
            render={<div />}
            truncate
            variant="note"
            data-zerops-surface="mate-snippet"
          >
            {snippet}
          </Text>
        )}
        {updateLine === undefined || updateLine === null ? null : (
          <Text
            className="flex min-w-0 items-center gap-1.5"
            render={<div />}
            variant="note"
            data-zerops-surface="mate-update-line"
          >
            {updateLine}
          </Text>
        )}
      </div>
      {action === undefined || action === null ? null : (
        <span className="relative z-[1] flex shrink-0" data-zerops-surface="mate-action">
          {action}
        </span>
      )}
      {layout === "card" ? <CardMenu menu={menu} /> : null}
    </div>
  );
  return layout === "card" ? (
    <Card className="w-full min-w-0" variant="flat">
      {body}
    </Card>
  ) : (
    body
  );
}

/** The menu, shown on hover or focus — always where there is no hover. */
function CardMenu({ menu, className }: { readonly menu: ReactNode; readonly className?: string }) {
  if (menu === undefined || menu === null) return null;
  return (
    <span
      className={cn(
        "relative z-[1] flex shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      {menu}
    </span>
  );
}
