/**
 * Switching Mates never leaves the pane without a conversation (T1). The one
 * the person leaves stays on screen as a still picture of its last frame
 * until the next one stands where it stays, then gives way to it: a 150 ms
 * crossfade, or a swap in one frame under reduced motion. Measured before:
 * the pane stood empty for 30 frames while a Mate opened for the first time
 * loaded and placed its rows, and for 10 while one opened before placed them.
 *
 * What never stood on screen is never pictured: switching on before the next
 * conversation shows anything keeps the picture already up. One slow to come
 * gives way after a while to its own pane, where its Mate is at work; that
 * pane is on screen too, and is held the same way when the person switches
 * away or while the rows that replace it are placed.
 */

export interface TimelineSwitchState {
  /** The conversation the route is on. */
  readonly key: string;
  /** Whether it has stood on screen where it stays. */
  readonly painted: boolean;
  /** Whether its own pane shows its Mate at work while it is on its way. */
  readonly waiting: boolean;
  /** The picture held over it until then: whose, and whether it is giving way. */
  readonly freeze: { readonly from: string; readonly fading: boolean } | null;
}

export type TimelineSwitchEvent =
  | { readonly type: "switch"; readonly to: string }
  | { readonly type: "painted"; readonly key: string }
  /** Its Mate at work shows on the conversation's own pane. */
  | { readonly type: "waiting"; readonly key: string }
  /** That pane gives way to the conversation's rows. */
  | { readonly type: "placing"; readonly key: string }
  | { readonly type: "held-too-long"; readonly key: string }
  | { readonly type: "faded" };

/**
 * What the pane does with its picture: take one of what it shows, fade the
 * one up, take it down, or nothing.
 */
export type TimelineSwitchEffect = "capture" | "fade" | "remove" | "none";

/**
 * Whether the pane shows the conversation's own layer — placed, or its Mate
 * at work — rather than a picture held over it: what a picture is taken of.
 */
export function showsTimelineLayer(state: TimelineSwitchState): boolean {
  return (state.painted || state.waiting) && (state.freeze === null || state.freeze.fading);
}

export function initialTimelineSwitch(key: string): TimelineSwitchState {
  return { key, painted: false, waiting: false, freeze: null };
}

export function stepTimelineSwitch(
  state: TimelineSwitchState,
  event: TimelineSwitchEvent,
  options: { readonly reducedMotion: boolean },
): { readonly state: TimelineSwitchState; readonly effect: TimelineSwitchEffect } {
  const unchanged = { state, effect: "none" } as const;
  switch (event.type) {
    case "switch": {
      if (event.to === state.key) return unchanged;
      if (showsTimelineLayer(state)) {
        return {
          state: {
            key: event.to,
            painted: false,
            waiting: false,
            freeze: { from: state.key, fading: false },
          },
          effect: "capture",
        };
      }
      return { state: { ...state, key: event.to, waiting: false }, effect: "none" };
    }
    case "painted": {
      if (event.key !== state.key || state.painted) return unchanged;
      const placed = { ...state, painted: true, waiting: false };
      if (state.freeze === null) return { state: placed, effect: "none" };
      if (options.reducedMotion) return { state: { ...placed, freeze: null }, effect: "remove" };
      if (state.freeze.fading) return { state: placed, effect: "none" };
      return { state: { ...placed, freeze: { ...state.freeze, fading: true } }, effect: "fade" };
    }
    case "waiting": {
      if (event.key !== state.key || state.painted) return unchanged;
      return { state: { ...state, waiting: true }, effect: "none" };
    }
    case "placing": {
      if (event.key !== state.key || !state.waiting || state.freeze !== null) return unchanged;
      return {
        state: { ...state, waiting: false, freeze: { from: state.key, fading: false } },
        effect: "capture",
      };
    }
    case "held-too-long": {
      if (event.key !== state.key || state.freeze === null || state.freeze.fading) {
        return unchanged;
      }
      if (options.reducedMotion) return { state: { ...state, freeze: null }, effect: "remove" };
      return { state: { ...state, freeze: { ...state.freeze, fading: true } }, effect: "fade" };
    }
    case "faded": {
      if (state.freeze === null || !state.freeze.fading) return unchanged;
      return { state: { ...state, freeze: null }, effect: "remove" };
    }
  }
}
