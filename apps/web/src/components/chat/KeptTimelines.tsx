/**
 * The conversation pane's lists (`keptTimelines.logic.ts`). The open
 * conversation's list shows; the last few left stay mounted out of sight, as
 * they stood when the person left them, so a return shows its rows in place
 * in the frame the header changes — nothing placed again, nothing faded in.
 * A kept list reads its conversation's rows while it is out of sight, so
 * rows that come meanwhile are placed at its end before it shows again.
 *
 * Out of sight and nobody about to open it, a kept list reads its
 * conversation at once as a turn starts or ends, and what streams there about
 * once a second (`useWarmTimeline`'s hold), not on every word: whichever way
 * the person comes back — the menu, ⌘K, a shortcut, back — its rows were
 * placed out of sight at most a second behind. Resting on its menu row lets
 * it read live again, before the press. Gone quiet — nothing read for a
 * while, no run going on — it is not laid out until it shows
 * (`content-visibility`, `keptRests`): its rows keep where they stand, and
 * what moves in it is not restyled unseen.
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
import {
  KEPT_RESTS_AFTER_MS,
  keepTimelines,
  keptRests,
  warmingTimeline,
  type KeptTimeline,
} from "./keptTimelines.logic";
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
function useKeptTimelineAlive(): (key: string) => boolean {
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
  alive: aliveAsSaid,
  warm = null,
  insetMeasured = true,
  insetRemembered = true,
  Reader = WarmTimelineReader,
  onReady,
}: {
  /** The open conversation's key. */
  readonly open: string;
  readonly onReady?: ((key: string, ready: boolean) => void) | undefined;
  /** The open conversation's list, its `listRef` the pane's own. */
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  /** Whether a kept conversation may stay; its Mate listing it, when not said. */
  readonly alive?: (key: string) => boolean;
  /** The conversation the person is about to open (`useWarmTimelineAsk`). */
  readonly warm?: string | null;
  /**
   * The open conversation's inset is measured since it opened, or at least
   * remembered from before. A list placed out of sight with another inset
   * waits out of sight for its own, a frame, rather than move once shown:
   * one never measured, and one whose conversation changed while it was
   * away — its banners may have too.
   */
  readonly insetMeasured?: boolean;
  readonly insetRemembered?: boolean;
  /** What reads an out-of-sight list's own props (`useWarmTimeline`). */
  readonly Reader?: TimelineReader;
}) {
  // Subscribed here, not by the view around: only the keeper hears the shells change.
  const listed = useKeptTimelineAlive();
  const alive = aliveAsSaid ?? listed;
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
      onStanding: (key: string, now: boolean) => {
        setStanding((held) =>
          held.key === key && held.standing === now ? held : { key, standing: now },
        );
        onReady?.(key, now);
      },
    }),
    [onReady],
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
          mode={insetMeasured ? "open" : insetRemembered ? "remembered" : "settling"}
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
        readsLive={warm === slot.key}
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

/** A kept list at rest out of sight: skipped by layout and style until it shows. */
const SKIPPED = { contentVisibility: "hidden" } as const;

/**
 * A list out of sight answers nothing the pane asks of the open one: where
 * its end is, a gesture, an anchor.
 */
function outOfSight(timeline: TimelineProps): TimelineProps {
  const { cancelPositionRestoreRef: _restore, ...rest } = timeline;
  return {
    ...rest,
    onIsAtEndChange: nothing,
    onPersonInput: nothing,
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
  readsLive = true,
}: {
  readonly threadKey: string;
  readonly Reader: TimelineReader;
  /**
   * Open; open but out of sight a frame more, its inset on its way; kept out
   * of sight; or warming for a conversation about to open.
   */
  readonly mode: "open" | "remembered" | "settling" | "hidden" | "warm";
  readonly timeline: TimelineProps;
  readonly crewTimeline: CrewTimeline | null;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly kept: KeptTimelineState;
  /** Kept out of sight, whether it reads its conversation live: someone is about to open it. */
  readonly readsLive?: boolean;
}) {
  // An out-of-sight list's own props, read beside it, so it takes the
  // conversation's rows as they come — an answer arriving while the person
  // is elsewhere is measured and placed out of sight, never on the return.
  // As it opens the reader goes and the list stays, the pane's props taking
  // over; kept again, it reads anew.
  const [warmed, setWarmed] = useState<WarmTimelineProps | null>(null);
  // Whether its conversation changed while it was out of sight.
  const [changedAway, setChangedAway] = useState(false);
  const changedNow =
    mode === "hidden" &&
    warmed !== null &&
    (warmed.latestTurn?.turnId !== timeline.latestTurn?.turnId ||
      warmed.latestTurn?.state !== timeline.latestTurn?.state ||
      warmed.latestTurn?.completedAt !== timeline.latestTurn?.completedAt);
  if (changedNow && !changedAway) setChangedAway(true);
  if (mode === "open" && changedAway) setChangedAway(false);
  const opened = mode === "open" || mode === "remembered" || mode === "settling";
  if (opened && warmed !== null) setWarmed(null);
  const shown = mode === "open" || (mode === "remembered" && !changedAway);
  // Kept out of sight, gone quiet: not laid out until it shows.
  const [quietSince, setQuietSince] = useState<WarmTimelineProps | null>(null);
  useEffect(() => {
    if (mode !== "hidden" || warmed === null) return;
    const quiet = setTimeout(() => setQuietSince(warmed), KEPT_RESTS_AFTER_MS);
    return () => clearTimeout(quiet);
  }, [mode, warmed]);
  const skipped = keptRests({
    hidden: mode === "hidden",
    readsLive,
    working: warmed?.isWorking === true || warmed?.runningTurnId != null,
    quiet: warmed !== null && quietSince === warmed,
  });
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
      style={skipped ? SKIPPED : undefined}
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
          hold={mode === "hidden" && !readsLive}
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
  /** Out of sight and nobody about to open it: it reads only as a turn starts or ends. */
  readonly hold: boolean;
  readonly openEnvironmentId: TimelineProps["activeThreadEnvironmentId"];
  readonly onRead: (props: WarmTimelineProps | null) => void;
}) => null;

function WarmTimelineReader({
  threadKey,
  hold,
  openEnvironmentId,
  onRead,
}: {
  readonly threadKey: string;
  readonly hold: boolean;
  readonly openEnvironmentId: TimelineProps["activeThreadEnvironmentId"];
  readonly onRead: (props: WarmTimelineProps | null) => void;
}) {
  const props = useWarmTimeline(threadKey, openEnvironmentId, hold);
  useLayoutEffect(() => {
    onRead(props);
  }, [onRead, props]);
  return null;
}
