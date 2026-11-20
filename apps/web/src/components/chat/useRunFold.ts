import { useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";
import { runFoldOf, subscribeRunFolds, transitionRunFold, type RunFold } from "./runCard.logic";
import { foldAway } from "./runFeedFold";
import type { Rooms } from "./runRoom";
import { heightOf } from "./runSlotGeometry";
import type { TimelineRowSharedState } from "./timelineContext";

/**
 * How a run's card stands in this conversation. Live work starts watched;
 * an explicit Show/Hide choice carries through completion. Otherwise, as it
 * settles its work eases shut into its line — unless the person is reading
 * it right then, when it stays open until they leave (`forgetRunFolds`) or it
 * is drawn again. A run that settled out of sight is simply folded, and so is
 * every run under reduced motion.
 */
export function useRunFold({
  conversation,
  run,
  live,
  asks,
  personKeys,
  readingRef,
  rootRef,
  aboveRef,
  liveHeightRef,
  roomsRef,
  onFoldWork,
}: {
  readonly conversation: string;
  readonly run: string;
  readonly live: boolean;
  /** Its run waits on the person. */
  readonly asks: boolean;
  /** Its items that involve the person: a run that goes on in it with a new one opens it. */
  readonly personKeys: ReadonlyArray<string>;
  readonly readingRef: { readonly current: boolean };
  readonly rootRef: { readonly current: HTMLElement | null };
  readonly aboveRef: { readonly current: HTMLElement | null };
  /** How tall the card stood in its last draw while its run was live. */
  readonly liveHeightRef: { readonly current: number | null };
  /** The card's own ease (`easeRooms`), which its fold takes over. */
  readonly roomsRef: { readonly current: Rooms | null };
  readonly onFoldWork: NonNullable<TimelineRowSharedState["onFoldWork"]>;
}): {
  readonly fold: RunFold;
  readonly foldNow: () => void;
  readonly settling: boolean;
  readonly motionAllowed: boolean;
  /** Its fold eases the card shut this moment: the card's own ease stands aside. */
  readonly foldShutsRef: { readonly current: boolean };
} {
  // A card drawn settled first is folded until it says otherwise, a run going on in it too: it
  // opens only as `observe` decides, never for a frame before.
  const [bornLive] = useState(live);
  const read = () => runFoldOf(conversation, run, live && bornLive ? "watched" : "folded");
  const stored = useSyncExternalStore(subscribeRunFolds, read, read);
  const fold = stored;
  const wasLiveRef = useRef(live);
  // What of the person it held while it stood settled.
  const settledPersonKeysRef = useRef<ReadonlySet<string>>(new Set());
  // The draw where the run settled, before its fold is measured: the card
  // holds its live height through it, or it jumps first.
  const [drawnLive, setDrawnLive] = useState(live);
  const settling = !live && drawnLive && stored === "watched";
  // How tall the card stood as the run settled: the fold starts there, the work under the head
  // taking up the room the present left, so the card's edge holds until it eases shut.
  const settledAtRef = useRef<number | null>(null);
  const foldShutsRef = useRef(false);
  const motionAllowed = () =>
    !prefersReducedMotion() &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");
  const measure = (height: number | null) => (motionAllowed() ? height : null);
  // It folds from the height it stands at now, easing the work shut under the head — at once under
  // reduced motion.
  const foldNow = () => {
    settledAtRef.current = measure(heightOf(rootRef.current));
    transitionRunFold(conversation, run, { kind: "hide", measured: settledAtRef.current !== null });
  };
  const observe = useEffectEvent((wasLive: boolean) => {
    settledAtRef.current = live
      ? null
      : (settledAtRef.current ?? (wasLive ? measure(liveHeightRef.current) : null));
    transitionRunFold(
      conversation,
      run,
      live
        ? {
            kind: "live",
            rejoined: !wasLive,
            asks: asks || personKeys.some((key) => !settledPersonKeysRef.current.has(key)),
          }
        : {
            kind: "settled",
            wasLive,
            reading: readingRef.current,
            measured: settledAtRef.current !== null,
          },
    );
  });
  useLayoutEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    setDrawnLive(live);
    observe(wasLive);
    // A run that asks the person opens the card it went on in folded.
  }, [conversation, run, live, asks, readingRef]);
  useLayoutEffect(() => {
    if (!live) settledPersonKeysRef.current = new Set(personKeys);
  }, [live, personKeys]);
  useLayoutEffect(() => {
    if (fold !== "folding") return;
    const from = settledAtRef.current;
    const above = aboveRef.current;
    const root = rootRef.current;
    let active = true;
    const done = () => {
      if (!active) return;
      active = false;
      foldShutsRef.current = false;
      settledAtRef.current = null;
      transitionRunFold(conversation, run, { kind: "finished" });
    };
    if (from === null || above === null || root === null) {
      done();
      return;
    }
    // What the card's own ease holds it at, that ease goes on easing (Milo's limit: nothing over
    // the line to fold, the card eased out what its slot left). A fold takes over from it at the
    // height its live draw stood: both easing, the card went on shrinking after the fold was done
    // (the owner's 29-step close, 2026-10-19: 17 px).
    if ((heightOf(above) ?? 0) + from - (heightOf(root) ?? from) >= 1) {
      foldShutsRef.current = true;
      roomsRef.current?.settle();
    }
    const cancel = foldAway(above, from - (heightOf(root) ?? from), done, onFoldWork);
    return () => {
      active = false;
      foldShutsRef.current = false;
      cancel();
    };
  }, [conversation, run, fold, aboveRef, rootRef, roomsRef, onFoldWork]);
  return { fold, foldNow, settling, motionAllowed: motionAllowed(), foldShutsRef };
}
