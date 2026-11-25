import { useState, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PERSON_DISC } from "./primitives/PersonAvatar";
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
 * `className` places it on a face of another size, or rings it in that face's ground.
 *
 * Its seat on a 36 px face: 16 px round, centred 30 px across and down — below the face's
 * corner, level with the ask, because a larger badge in the corner met the done face's smile;
 * there it clears every pose's eyes and mouth by 1.3 px (the owner, 2026-09-30: "the not yours
 * should have the avatar bigger"). The face wears the seat cut out of it (`FACE_CUT`), so the mark
 * holds on the hover band and the open Mate's band alike.
 */
const SEAT =
  "absolute top-5.5 left-5.5 inline-flex size-4 items-center justify-center overflow-hidden rounded-full text-4xs";
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
              // An empty seat: a dashed ring in the muted ink, no fill and no hairline, so it never
              // reads as a person without a picture.
              className={cn(SEAT, "text-sidebar-muted-foreground/75", className)}
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
            className={cn(PERSON_DISC, SEAT, "ring-sidebar-foreground/8", className)}
            data-zerops-avatar={picture === null ? "initials" : "picture"}
            data-zerops-surface="sidebar-mate-owner"
            style={{ "--person-hue": mark.hue } as CSSProperties}
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
