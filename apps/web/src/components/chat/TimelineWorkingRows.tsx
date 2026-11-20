import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { takePanelStand, panelLeftRecently, usePanelStand } from "./timelinePanelStand";
import { TurnReport } from "./TurnReport";
import { ConversationWorking } from "./ConversationWorking";
import { easeRooms, type Rooms } from "./runRoom";
import type { CarriedRow } from "./stepHeight";
import { TimelineRowCtx, TimelineWorkingCtx } from "./timelineContext";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";

/**
 * Turns whose Mate at work this page watched live: their report arrives as
 * the panel settles into it, once. A report scrolled back into view, or read
 * after a reload, is simply there.
 */
const watchedTurnKeys = new Set<string>();

/** What runs alongside the Mate, under its record. */
export function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const ctx = use(TimelineRowCtx);
  const dock = use(TimelineWorkingCtx);
  useEffect(() => {
    watchedTurnKeys.add(row.turnKey);
  }, [row.turnKey]);
  const standRef = usePanelStand(row.turnKey, row.cardKey);
  const { cardKey } = row;
  const carry = useCallback(() => cardRowsCarried(standRef.current, cardKey), [standRef, cardKey]);
  // The card's line it lent room to: taken back when the room closes, and when this row leaves
  // mid-close — a run that settled as its panel closed kept the room as an empty band of card
  // at its foot, under the composer (the owner, 0.15.44, a stopped run's two helpers).
  const lentRef = useRef<HTMLElement | null>(null);
  const onRoom = useCallback(
    (room: number | null) => {
      lentRef.current = holdCardRoom(standRef.current, cardKey, room) ?? lentRef.current;
      if (room === null || room < 0.5) {
        lentRef.current?.style.removeProperty("--card-room");
        lentRef.current = null;
      }
    },
    [standRef, cardKey],
  );
  useEffect(
    () => () => {
      lentRef.current?.style.removeProperty("--card-room");
      lentRef.current = null;
    },
    [],
  );
  return (
    <div ref={standRef} className="contents">
      <ConversationWorking
        carry={carry}
        onRoom={onRoom}
        dock={dock}
        environmentId={ctx.activeThreadEnvironmentId}
        incidents={row.incidents}
        onOpenAgents={ctx.onOpenAgents}
        threadRef={ctx.threadRef}
      />
    </div>
  );
}

/**
 * The room a live card's panel holds while it closes (`ConversationWorking`),
 * on the card's line: drawn whole by that row (`[data-card-whole]`), the card
 * reaches over it (`--card-room`).
 */
function holdCardRoom(
  from: HTMLElement | null,
  cardKey: string,
  room: number | null,
): HTMLElement | null {
  const list = from?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  const line = list?.querySelector<HTMLElement>(
    `[data-timeline-row-id="${CSS.escape(`record:${cardKey}`)}"] > .run-tray`,
  );
  if (line === null || line === undefined) return null;
  if (room === null || room < 0.5) {
    line.style.removeProperty("--card-room");
    return null;
  }
  line.style.setProperty("--card-room", `${room}px`);
  return line;
}

/**
 * The rows of a live card the list moves as what runs alongside gives its
 * room back (`ConversationWorking`), from inside that card's working row.
 * Following its end, the list re-pins to it, and what stands above the room
 * goes down with it — the card's line and the room's own row — while the
 * card's edge stands still. Else the list keeps its place, and the card's
 * edge comes up.
 */
function cardRowsCarried(
  from: HTMLElement | null,
  cardKey: string,
): ReadonlyArray<CarriedRow> | null {
  const own = from?.closest<HTMLElement>("[data-card-slice]") ?? null;
  const list = own?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  if (own === null || list === null) return null;
  const find = (id: string) =>
    list.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(id)}"]`);
  const line = find(`record:${cardKey}`);
  const edge = find(`card-end:${cardKey}`);
  // A turn landing under its held head keeps its place: the card's edge comes up.
  if (
    own.closest("[data-timeline-follows-end]") !== null &&
    !list.hasAttribute("data-timeline-holds-head")
  ) {
    return [
      ...(line === null ? [] : [{ row: line, direction: 1 as const }]),
      { row: own, direction: 1 },
      ...(edge === null ? [] : [{ row: edge, direction: 0 as const }]),
    ];
  }
  return edge === null ? [] : [{ row: edge, direction: -1 }];
}

export function OutcomeTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "outcome" }> }) {
  const ctx = use(TimelineRowCtx);
  const [settling] = useState(() => watchedTurnKeys.delete(row.outcome.turnKey));
  const markerRef = useRef<HTMLDivElement>(null);
  const roomsRef = useRef<Rooms | null>(null);
  const turnKey = row.outcome.turnKey;
  // The panel it replaces stood here a moment ago: the report's band of the
  // card starts at the panel's height and eases to its own.
  useLayoutEffect(() => {
    const band = markerRef.current?.parentElement;
    if (!band) return;
    const rooms = easeRooms({
      root: band,
      selector: ":not(*)",
      eases: () => true,
      rootClips: true,
    });
    roomsRef.current = rooms;
    const stand = takePanelStand(turnKey);
    if (stand !== null) rooms.easeFrom(band, stand.panel);
    // Its panel already folded into the Mate's last word: the report came
    // after. Natural growth, including a handoff from zero, takes its full height.
    else if (panelLeftRecently(turnKey)) rooms.easeFrom(band, 0);
    return () => {
      rooms.stop();
      roomsRef.current = null;
    };
  }, [turnKey]);
  // Hear content changes before the outer list measures this commit.
  useLayoutEffect(() => roomsRef.current?.flush());
  return (
    // The result stands under the worked line, inside the tray (T5): a
    // hairline, then its rows in the card's grid; nothing at all when the run
    // left none.
    <div ref={markerRef} className="run-band">
      <TurnReport onOpenImage={ctx.onImageExpand} outcome={row.outcome} settling={settling} />
    </div>
  );
}
