/**
 * The conversation pane's lists (`keptTimelines.logic.ts`). The open
 * conversation's list shows; the last few left stay mounted out of sight, as
 * they stood when the person left them, so a return shows its rows in place
 * in the frame the header changes — nothing placed again, nothing faded in.
 * A kept list reads its conversation's rows while it is out of sight, so
 * rows that come meanwhile are placed at its end before it shows again.
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
import {
  KEPT_OUT_OF_SIGHT,
  KeptTimelineContext,
  type KeptTimelineState,
} from "./keptTimelineContext";
import { keepTimelines, warmingTimeline, type KeptTimeline } from "./keptTimelines.logic";
import { useWarmTimeline, type WarmTimelineProps } from "./useWarmTimeline";
import { rememberedTimelineInset } from "./timelineInsets";
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
  warm = null,
  insetSettled = true,
  Reader = WarmTimelineReader,
}: {
  /** The open conversation's key. */
  readonly open: string;
  /** The open conversation's list, its `listRef` the pane's own. */
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  /** Whether a kept conversation may stay (`useKeptTimelineAlive`). */
  readonly alive: (key: string) => boolean;
  /** The conversation the person is about to open (`useWarmTimelineAsk`). */
  readonly warm?: string | null;
  /**
   * The open conversation's inset is its own: remembered, or measured since
   * it opened. A list placed out of sight with another waits out of sight for
   * it, a frame, rather than move once shown.
   */
  readonly insetSettled?: boolean;
  /** What reads an out-of-sight list's own props (`useWarmTimeline`). */
  readonly Reader?: TimelineReader;
}) {
  const [kept, setKept] = useState<ReadonlyArray<KeptTimeline>>(() =>
    keepTimelines([], { open, alive }),
  );
  const next = keepTimelines(kept, { open, alive });
  if (next !== kept) setKept(next);
  // Whether the open list stands where it stays: nothing warms while it is placed.
  const [standing, setStanding] = useState<{ readonly key: string; readonly standing: boolean }>({
    key: open,
    standing: false,
  });
  const openShown = useMemo(
    () => ({
      shown: true,
      onStanding: (key: string, now: boolean) =>
        setStanding((held) =>
          held.key === key && held.standing === now ? held : { key, standing: now },
        ),
    }),
    [],
  );
  const warming = warmingTimeline({
    asked: warm !== null && alive(warm) ? warm : null,
    open,
    kept: next,
    placing: !(standing.key === open && standing.standing),
  });
  // The pane's own props a warming list is drawn with, as they were when it began.
  const [warmBase, setWarmBase] = useState<{
    readonly key: string;
    readonly timeline: TimelineProps;
  } | null>(null);
  if (warming === null && warmBase !== null) setWarmBase(null);
  if (warming !== null && warmBase?.key !== warming) {
    const inset = rememberedTimelineInset(warming);
    setWarmBase({
      key: warming,
      timeline: inset === undefined ? timeline : { ...timeline, contentInsetEndAdjustment: inset },
    });
  }
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

  // One list of slots, so a list warming keeps its instance as it opens.
  const slots = next.map((slot) => {
    if (slot.key === open) {
      return (
        <TimelineSlot
          key={slot.key}
          threadKey={slot.key}
          Reader={Reader}
          crewTimeline={crewTimeline}
          kept={openShown}
          listRef={timeline.listRef}
          mode={insetSettled ? "open" : "settling"}
          timeline={timeline}
        />
      );
    }
    const last = shown.current.get(slot.key);
    return last === undefined ? null : (
      <TimelineSlot
        key={slot.key}
        threadKey={slot.key}
        Reader={Reader}
        crewTimeline={last.crewTimeline}
        kept={KEPT_OUT_OF_SIGHT}
        listRef={listRefOf(slot.key)}
        mode="hidden"
        timeline={last.timeline}
      />
    );
  });
  if (warming !== null && warmBase?.key === warming) {
    slots.push(
      <TimelineSlot
        key={warming}
        threadKey={warming}
        Reader={Reader}
        crewTimeline={null}
        kept={KEPT_OUT_OF_SIGHT}
        listRef={listRefOf(warming)}
        mode="warm"
        timeline={warmBase.timeline}
      />,
    );
  }
  return slots;
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
  threadKey,
  Reader,
  mode,
  timeline,
  crewTimeline,
  listRef,
  kept,
}: {
  readonly threadKey: string;
  readonly Reader: TimelineReader;
  /**
   * Open; open but out of sight a frame more, its inset on its way; kept out
   * of sight; or warming for a conversation about to open.
   */
  readonly mode: "open" | "settling" | "hidden" | "warm";
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly kept: KeptTimelineState;
}) {
  // An out-of-sight list's own props, read beside it, so it takes the
  // conversation's rows as they come — an answer arriving while the person
  // is elsewhere is measured and placed out of sight, never on the return.
  // As it opens the reader goes and the list stays, the pane's props taking
  // over; kept again, it reads anew.
  const [warmed, setWarmed] = useState<WarmTimelineProps | null>(null);
  const opened = mode === "open" || mode === "settling";
  if (opened && warmed !== null) setWarmed(null);
  const shown = mode === "open";
  const props: TimelineProps | null = opened
    ? timeline
    : mode === "hidden"
      ? { ...outOfSight(timeline), ...warmed }
      : warmed === null
        ? null
        : { ...outOfSight(timeline), ...warmed };
  return (
    <div
      aria-hidden={shown ? undefined : true}
      className={shown ? "contents" : "pointer-events-none invisible absolute inset-0"}
      data-kept-timeline={shown ? undefined : ""}
      inert={!shown}
    >
      {props === null ? null : (
        <KeptTimelineContext key="list" value={kept}>
          <CrewTimelineContext value={crewTimeline}>
            <MessagesTimeline {...props} listRef={listRef} />
          </CrewTimelineContext>
        </KeptTimelineContext>
      )}
      {!opened ? (
        <Reader
          key="reader"
          onRead={setWarmed}
          openEnvironmentId={timeline.activeThreadEnvironmentId}
          threadKey={threadKey}
        />
      ) : null}
    </div>
  );
});

/** Reads a conversation's own list props for a list out of sight, and tells them. */
export type TimelineReader = (props: {
  readonly threadKey: string;
  readonly openEnvironmentId: TimelineProps["activeThreadEnvironmentId"];
  readonly onRead: (props: WarmTimelineProps | null) => void;
}) => null;

function WarmTimelineReader({
  threadKey,
  openEnvironmentId,
  onRead,
}: {
  readonly threadKey: string;
  readonly openEnvironmentId: TimelineProps["activeThreadEnvironmentId"];
  readonly onRead: (props: WarmTimelineProps | null) => void;
}) {
  const props = useWarmTimeline(threadKey, openEnvironmentId);
  useLayoutEffect(() => {
    onRead(props);
  }, [onRead, props]);
  return null;
}
