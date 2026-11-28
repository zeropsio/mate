/**
 * Whether a task's card stands in sight in its conversation: its bar (`MateTaskBar`) stands in for
 * it once it scrolled away. The card is watched for crossings (`watchCrossings`, an observer that
 * rests while the page stands still) while it is mounted (the
 * timeline's list mounts only rows near the view, so a card it let go is out of sight), never by a
 * scroll listener. The tab's own and never kept.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { MateTaskSource } from "@t3tools/contracts";

import { watchCrossings } from "~/lib/restingIntersections";

/** The card of a task in a conversation, by its conversation and the task it opened its turn with. */
export function taskCardKey(input: {
  readonly environmentId: string;
  readonly conversationId: string;
  readonly taskId: string | null;
  readonly source: MateTaskSource;
}): string {
  return [input.environmentId, input.conversationId, input.taskId ?? input.source.title].join("\n");
}

/** Cards mounted now, by key: in sight or not. A card not mounted is not here. */
const sights = new Map<string, boolean>();
const listeners = new Set<() => void>();
function setSight(key: string, inSight: boolean | undefined): void {
  if (sights.get(key) === inSight) return;
  if (inSight === undefined) sights.delete(key);
  else sights.set(key, inSight);
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The nearest ancestor that scrolls: the card is out of sight where it clips the card away. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return at;
  }
  return null;
}

/**
 * Watches the card of `key`: a ref for its element. Where it stands is read as it mounts, before
 * it paints, so a bar never shows for a frame over a card in sight; the observer says each change
 * after; unmounted, it is no longer here.
 */
export function useWatchTaskCard(
  key: string,
): (element: HTMLElement | null) => (() => void) | void {
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null) return;
      const scroller = scrollerOf(element);
      const card = element.getBoundingClientRect();
      const view = scroller?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
      };
      setSight(key, card.bottom > view.top && card.top < view.bottom);
      const crossings = watchCrossings((entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined) setSight(key, entry.isIntersecting);
      });
      crossings?.observe(element);
      return () => {
        crossings?.disconnect();
        setSight(key, undefined);
      };
    },
    [key],
  );
}

/** Whether the card of `key` is in sight: `undefined` while no card of it is mounted. */
export function useTaskCardSight(key: string): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => sights.get(key),
    () => undefined,
  );
}
