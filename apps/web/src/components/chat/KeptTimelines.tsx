/**
 * The conversation pane's lists (`keptTimelines.logic.ts`). The open
 * conversation's list shows; the last few left stay mounted out of sight, as
 * they stood when the person left them, so a return shows its rows in place
 * in the frame the header changes — nothing placed again, nothing faded in.
 * A kept list is drawn as it was last shown, and takes the conversation's
 * rows as they are now when it shows again: rows that came meanwhile are at
 * its end.
 *
 * Not `<Activity mode="hidden">`: under it a list is `display: none` with
 * its effects gone, so a list warming (a conversation about to open) could
 * never measure and place its rows; out of sight here a list keeps its
 * layout and its effects, and shows with nothing measured again.
 */
import {
  createRef,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadShells } from "../../state/entities";

import { CrewTimelineContext, type CrewTimeline } from "../zerops/crew/CrewTaskCard";
import { KEPT_OUT_OF_SIGHT, KEPT_SHOWN, KeptTimelineContext } from "./keptTimelineContext";
import { keepTimelines, type KeptTimeline } from "./keptTimelines.logic";
import { MessagesTimeline } from "./MessagesTimeline";
import { forgetRunFolds } from "./runCard.logic";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

interface Shown {
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
}

/**
 * A kept conversation stays while its Mate lists it: a Mate removed, or the
 * conversation deleted, takes its list with it.
 */
export function useKeptTimelineAlive(): (key: string) => boolean {
  const threads = useThreadShells();
  return useMemo(() => {
    const present = new Set(
      threads.map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    return (key: string) => present.has(key);
  }, [threads]);
}

export function KeptTimelines({
  open,
  timeline,
  crewTimeline,
  alive,
}: {
  /** The open conversation's key. */
  readonly open: string;
  /** The open conversation's list, its `listRef` the pane's own. */
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  /** Whether a kept conversation may stay (`useKeptTimelineAlive`). */
  readonly alive: (key: string) => boolean;
}) {
  const [kept, setKept] = useState<ReadonlyArray<KeptTimeline>>(() =>
    keepTimelines([], { open, alive }),
  );
  const next = keepTimelines(kept, { open, alive });
  if (next !== kept) setKept(next);
  // What each list showed last, drawn as it is while it is hidden.
  const shown = useRef(new Map<string, Shown>());
  const listRefs = useRef(new Map<string, RefObject<LegendListRef | null>>());
  const listRefOf = (key: string) => {
    let ref = listRefs.current.get(key);
    if (ref === undefined) {
      ref = createRef<LegendListRef | null>();
      listRefs.current.set(key, ref);
    }
    return ref;
  };

  useLayoutEffect(() => {
    shown.current.set(open, { timeline, crewTimeline });
    for (const key of [...shown.current.keys()]) {
      if (next.some((slot) => slot.key === key)) continue;
      // Let go: its runs fold as it goes, as a list unmounting folds them.
      shown.current.delete(key);
      listRefs.current.delete(key);
      forgetRunFolds(key);
    }
  });
  useEffect(() => {
    const kept = shown.current;
    return () => {
      for (const key of kept.keys()) forgetRunFolds(key);
    };
  }, []);

  return (
    <>
      {next.map((slot) => {
        if (slot.key === open) {
          return (
            <TimelineSlot
              key={slot.key}
              crewTimeline={crewTimeline}
              listRef={timeline.listRef}
              shown
              timeline={timeline}
            />
          );
        }
        const last = shown.current.get(slot.key);
        return last === undefined ? null : (
          <TimelineSlot
            key={slot.key}
            crewTimeline={last.crewTimeline}
            listRef={listRefOf(slot.key)}
            shown={false}
            timeline={last.timeline}
          />
        );
      })}
    </>
  );
}

const nothing = () => undefined;

/**
 * A list out of sight answers nothing the pane asks of the open one: where
 * its end is, a gesture, an anchor.
 */
function outOfSight(timeline: TimelineProps): TimelineProps {
  const { cancelPositionRestoreRef: _restore, ...rest } = timeline;
  return {
    ...rest,
    onIsAtEndChange: nothing,
    onManualNavigation: nothing,
    onAnchorReady: nothing,
  };
}

/**
 * One list. Out of sight it keeps its layout — invisible, over the open one's
 * place, at its size — so it is never measured again as it shows: its rows
 * stand where they stood, and a list warming places its rows there too.
 */
const TimelineSlot = memo(function TimelineSlot({
  shown,
  timeline,
  crewTimeline,
  listRef,
}: {
  readonly shown: boolean;
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  readonly listRef: RefObject<LegendListRef | null>;
}) {
  return (
    <div
      aria-hidden={shown ? undefined : true}
      className={shown ? "contents" : "pointer-events-none invisible absolute inset-0"}
      data-kept-timeline={shown ? undefined : ""}
      inert={!shown}
    >
      <KeptTimelineContext value={shown ? KEPT_SHOWN : KEPT_OUT_OF_SIGHT}>
        <CrewTimelineContext value={crewTimeline}>
          <MessagesTimeline {...(shown ? timeline : outOfSight(timeline))} listRef={listRef} />
        </CrewTimelineContext>
      </KeptTimelineContext>
    </div>
  );
});
