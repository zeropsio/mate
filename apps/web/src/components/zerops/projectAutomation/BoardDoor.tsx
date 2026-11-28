/**
 * The way to an application's Board, `/group/$groupId/board`, with how many of its tasks wait for
 * the reader (`boardWaitingCount`) once that is read and some do: one door, in the project page's
 * header and in the header of every conversation with a Mate of the application.
 */
import { Link } from "@tanstack/react-router";
import { SquareKanbanIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export function BoardDoor({
  groupId,
  count,
  place,
}: {
  /** The application; `null` while it is not known: the door's room, nothing to press. */
  readonly groupId: string | null;
  readonly count: number | undefined;
  /**
   * `page`: a page header's door, beside its other presses; `header`: a conversation's top bar,
   * borderless like Project and Sites beside it, its word given way in a narrow header.
   */
  readonly place: "page" | "header";
}) {
  const waiting = count !== undefined && count > 0;
  return (
    <Button
      aria-label={waiting ? `Board, ${String(count)} waiting for you` : "Board"}
      data-zerops-surface="board-door"
      {...(groupId === null
        ? {}
        : { render: <Link params={{ groupId }} to="/group/$groupId/board" /> })}
      size="sm"
      variant={place === "page" ? "secondary" : "sidebar"}
    >
      <SquareKanbanIcon aria-hidden="true" />
      <span
        className={place === "page" ? undefined : "hidden text-line @3xl/header-actions:inline"}
      >
        Board
      </span>
      {waiting ? <Badge count>{count}</Badge> : null}
    </Button>
  );
}
