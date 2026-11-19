/**
 * The conversation the person is about to open (`KeptTimelines` warms it):
 * the menu row they rest on for 100 ms, the one they focus, the one a finger
 * stays on for as long. Only the newest is asked for; it stays asked until
 * another is.
 */
import { useSyncExternalStore, type FocusEvent, type PointerEvent } from "react";
import { useRef } from "react";

import { onAccountLifetimeClose } from "../../zerops/accountLifetime";

/** How long the pointer, or a finger, rests on a row before its conversation warms. */
export const WARM_AFTER_REST_MS = 100;

let asked: string | null = null;
const listeners = new Set<() => void>();

function ask(threadKey: string | null) {
  if (asked === threadKey) return;
  asked = threadKey;
  for (const listener of listeners) listener();
}

onAccountLifetimeClose(() => ask(null));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The conversation asked to warm, by its thread key; null when none. */
export function useWarmTimelineAsk(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => asked,
    () => null,
  );
}

/**
 * A menu row's intent to open its conversation: the pointer resting on it,
 * focus, a finger staying on it. `threadKey` is the conversation the row opens.
 */
export function useWarmIntent(threadKey: string | undefined) {
  const rest = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (rest.current !== null) clearTimeout(rest.current);
    rest.current = null;
  };
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (threadKey === undefined || event.pointerType === "touch") return;
      cancel();
      rest.current = setTimeout(() => ask(threadKey), WARM_AFTER_REST_MS);
    },
    onPointerLeave: cancel,
    // A touch that starts a scroll is the list's: the browser cancels it within its first moves,
    // before the rest is over. Warmed at once, every scroll begun on a row built a conversation
    // nobody opened, under the scrolling finger.
    onPointerDown: (event: PointerEvent) => {
      if (threadKey === undefined || event.pointerType !== "touch") return;
      cancel();
      rest.current = setTimeout(() => ask(threadKey), WARM_AFTER_REST_MS);
    },
    onPointerCancel: cancel,
    onFocus: (_event: FocusEvent) => {
      if (threadKey !== undefined) ask(threadKey);
    },
  };
}
