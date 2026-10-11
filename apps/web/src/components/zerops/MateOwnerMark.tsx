import { useState, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { BadgeSeat } from "./SidebarMateRow.logic";

/**
 * Whose Mate it is, on the corner of its face (`OwnerSeat`): a colleague's
 * picture, 12 px round and cut out of the face rather than laid over it, or
 * their initial on a colour of their own (`ownerMark`) — never before the
 * name, where "(face) Cleo" read as a person called Cleo (the owner,
 * 2026-09-30). A Mate whose records name nobody sits on an empty seat there:
 * a dashed ring in the muted ink, the "no assignee" convention — never a
 * person without a picture, never a spinner — said in words on hover. The
 * badge stands in the face's box, so nothing moves when it arrives.
 *
 * The initial is part of a mark, not text: 7 px inside the 12 px disc, as a
 * picture would be. The menu's row and a Mate's card wear the same mark;
 * `className` places it on a face of another size.
 */
export function MateOwnerMark({
  seat,
  className,
}: {
  readonly seat: BadgeSeat;
  readonly className?: string | undefined;
}) {
  const [failed, setFailed] = useState(false);
  if (seat.kind === "nobody") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn("menu-owner", className)}
              data-zerops-avatar="nobody"
              data-zerops-surface="sidebar-mate-owner"
            />
          }
        >
          {/* Twelve even dashes: `pathLength` makes the ring's length 24, so
              the pattern closes on itself with no short dash at the seam. */}
          <svg aria-hidden="true" className="size-full" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              fill="none"
              pathLength="24"
              r="7.25"
              stroke="currentColor"
              strokeDasharray="1.25 0.75"
              strokeWidth="1.25"
            />
          </svg>
          <span className="sr-only">{seat.label}</span>
        </TooltipTrigger>
        <TooltipPopup side="right">{seat.label}</TooltipPopup>
      </Tooltip>
    );
  }
  const { mark } = seat;
  const picture = failed ? null : mark.picture;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("menu-owner", className)}
            data-zerops-avatar={picture === null ? "initials" : "picture"}
            data-zerops-surface="sidebar-mate-owner"
            style={{ "--menu-owner-hue": mark.hue } as CSSProperties}
          />
        }
      >
        {picture === null ? (
          <span aria-hidden="true">{mark.initial}</span>
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            onError={() => {
              setFailed(true);
            }}
            src={picture}
          />
        )}
        <span className="sr-only">{mark.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{mark.label}</TooltipPopup>
    </Tooltip>
  );
}
