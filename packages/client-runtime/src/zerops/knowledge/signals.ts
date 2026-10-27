/**
 * The PlatformSignals port and the wake definition (DESIGN §6.4): what the account's machines hear
 * of the tab — its visibility, its network, and the coalesced wake — from the browser's raw
 * lifecycle events. Signals are never a source of platform truth; they only tell a machine to look
 * again.
 *
 * - **Visible wake**, at most one per 10 s: shown again after at least 30 s hidden, a return from
 *   the back-forward cache, `resume`, `online`, a sleep while visible, and focus back after at
 *   least 30 s hidden or blurred. A click into an iframe and back, or a short tab switch, is not
 *   one.
 * - **Hidden wake**, at most one per 10 s: `resume` or a sleep while hidden. It only re-evaluates
 *   deadlines; retries wait for the next visible wake.
 * - **Restored**, never coalesced: a return from the back-forward cache, which the browser raises
 *   amid `resume` and `visibilitychange` within one wake's window. It says every socket the page
 *   held is gone, whether or not its wake survived coalescing.
 * - **Sleep** is the two clocks drifting more than 5 s apart between two ticks, or two ticks more
 *   than 5 min apart. A throttled hidden tab ticks about once a minute, on both clocks alike, so
 *   throttling alone never looks like a sleep.
 *
 * `wakeStep` is the pure definition; `makePlatformSignals` runs it over one page for every
 * listener.
 */

/** Both clocks at one moment: the wall clock, and the monotonic one that a sleep may stop. */
export interface SignalClocks {
  readonly wall: number;
  readonly mono: number;
}

/** A browser's raw lifecycle events, as a platform adapter hears them. */
export type PageEvent =
  | { readonly type: "visibility"; readonly hidden: boolean }
  | { readonly type: "focus" }
  | { readonly type: "blur" }
  | { readonly type: "pageshow"; readonly persisted: boolean }
  | { readonly type: "resume" }
  | { readonly type: "online" }
  | { readonly type: "offline" }
  /** The adapter's periodic tick: a sleep shows as a gap between two of them. */
  | { readonly type: "tick" };

/** What raised a wake. */
export type WakeCause = "shown" | "focus" | "pageshow" | "resume" | "online" | "sleep";

export type PlatformSignal =
  | { readonly type: "visibility"; readonly hidden: boolean }
  | { readonly type: "network"; readonly online: boolean }
  /** The page came back from the back-forward cache: every socket it held is gone. */
  | { readonly type: "restored" }
  /**
   * The coalesced wake. A visible one fires pending retries now and resets every backoff; a hidden
   * one only re-evaluates deadlines.
   */
  | { readonly type: "wake"; readonly visible: boolean; readonly cause: WakeCause };

/** The PlatformSignals port: the tab as the account's machines hear it. */
export interface PlatformSignals {
  readonly hidden: () => boolean;
  readonly online: () => boolean;
  /** Tells `hear` every signal from now on, until the returned function stops it. */
  readonly listen: (hear: (signal: PlatformSignal) => void) => () => void;
}

/** A visibility return or a focus is a wake only after the tab was away at least this long. */
export const WAKE_AFTER_AWAY_MS = 30_000;

/** Wakes of one kind, visible or hidden, are coalesced to at most one per this long. */
export const WAKE_COALESCE_MS = 10_000;

/** How often an adapter ticks while it is heard; a throttled hidden tab ticks about once a minute. */
export const SIGNALS_TICK_MS = 15_000;

/** A sleep: the wall clock ran this much further than the monotonic one between two ticks… */
export const SLEEP_CLOCK_DRIFT_MS = 5_000;
/** …or two ticks this far apart, beyond the one-minute bucket of hidden-tab throttling. */
export const SLEEP_TICK_GAP_MS = 5 * 60_000;

export interface WakeState {
  readonly hidden: boolean;
  readonly online: boolean;
  /** Since when the document has been hidden; null while it is visible. */
  readonly hiddenSince: SignalClocks | null;
  /** Since when the window has been without focus, hidden or not; null while it has it. */
  readonly blurredSince: SignalClocks | null;
  /** The last tick; null before the first. */
  readonly tickedAt: SignalClocks | null;
  /** The last wake of each kind; null before the first. */
  readonly lastWake: {
    readonly visible: SignalClocks | null;
    readonly hidden: SignalClocks | null;
  };
}

export function initialWakeState(
  page: { readonly hidden: boolean; readonly online: boolean },
  now: SignalClocks,
): WakeState {
  return {
    hidden: page.hidden,
    online: page.online,
    hiddenSince: page.hidden ? now : null,
    blurredSince: page.hidden ? now : null,
    tickedAt: null,
    lastWake: { visible: null, hidden: null },
  };
}

/** How long since `since`, on whichever clock ran further: a sleep may stop the monotonic one. */
const elapsed = (since: SignalClocks, now: SignalClocks): number =>
  Math.max(now.wall - since.wall, now.mono - since.mono);

const slept = (since: SignalClocks, now: SignalClocks): boolean =>
  now.wall - since.wall - (now.mono - since.mono) > SLEEP_CLOCK_DRIFT_MS ||
  elapsed(since, now) > SLEEP_TICK_GAP_MS;

const awayLongEnough = (since: SignalClocks | null, now: SignalClocks): boolean =>
  since !== null && elapsed(since, now) >= WAKE_AFTER_AWAY_MS;

export interface WakeStep {
  readonly state: WakeState;
  readonly signals: ReadonlyArray<PlatformSignal>;
}

/**
 * Adds a wake to `signals`, unless one of its kind came within 10 s. It is visible when the page
 * is, or when `shown` says the page is being shown before it reports itself visible.
 */
function withWake(
  state: WakeState,
  signals: ReadonlyArray<PlatformSignal>,
  cause: WakeCause,
  now: SignalClocks,
  shown = !state.hidden,
): WakeStep {
  const kind = shown ? "visible" : "hidden";
  const last = state.lastWake[kind];
  if (last !== null && elapsed(last, now) < WAKE_COALESCE_MS) return { state, signals };
  return {
    state: { ...state, lastWake: { ...state.lastWake, [kind]: now } },
    signals: [...signals, { type: "wake", visible: shown, cause }],
  };
}

const unchanged = (state: WakeState): WakeStep => ({ state, signals: [] });

export function wakeStep(state: WakeState, event: PageEvent, now: SignalClocks): WakeStep {
  switch (event.type) {
    case "visibility": {
      if (event.hidden === state.hidden) return unchanged(state);
      const visibility: PlatformSignal = { type: "visibility", hidden: event.hidden };
      if (event.hidden) {
        return {
          state: {
            ...state,
            hidden: true,
            hiddenSince: now,
            blurredSince: state.blurredSince ?? now,
          },
          signals: [visibility],
        };
      }
      const shown = { ...state, hidden: false, hiddenSince: null };
      return awayLongEnough(state.hiddenSince, now)
        ? withWake(shown, [visibility], "shown", now)
        : { state: shown, signals: [visibility] };
    }
    case "blur":
      return { state: { ...state, blurredSince: state.blurredSince ?? now }, signals: [] };
    case "focus": {
      const focused = { ...state, blurredSince: null };
      return !state.hidden && awayLongEnough(state.blurredSince, now)
        ? withWake(focused, [], "focus", now)
        : unchanged(focused);
    }
    case "pageshow":
      // A restore shows the page, even while it still reports itself hidden.
      return event.persisted
        ? withWake(state, [{ type: "restored" }], "pageshow", now, true)
        : unchanged(state);
    case "resume":
      return withWake(state, [], "resume", now);
    case "online": {
      const online: WakeStep = {
        state: { ...state, online: true },
        signals: [{ type: "network", online: true }],
      };
      // Coming back online while hidden waits for the visible wake like every other retry.
      return state.hidden ? online : withWake(online.state, online.signals, "online", now);
    }
    case "offline":
      return {
        state: { ...state, online: false },
        signals: [{ type: "network", online: false }],
      };
    case "tick": {
      const ticked = { ...state, tickedAt: now };
      return state.tickedAt !== null && slept(state.tickedAt, now)
        ? withWake(ticked, [], "sleep", now)
        : unchanged(ticked);
    }
  }
}

/** One page as a platform adapter reports it: its state now, its clocks, and its raw events. */
export interface PageSource {
  readonly hidden: () => boolean;
  readonly online: () => boolean;
  readonly now: () => SignalClocks;
  /** Tells `hear` every raw event, the adapter's ticks among them, until the returned function stops it. */
  readonly listen: (hear: (event: PageEvent) => void) => () => void;
}

/**
 * The PlatformSignals port over one page: one wake definition for every listener, so each hears the
 * same coalesced wakes. The page is heard only while someone listens; a first listener starts the
 * definition from the page as it is then.
 */
export function makePlatformSignals(page: PageSource): PlatformSignals {
  const listeners = new Set<(signal: PlatformSignal) => void>();
  let state: WakeState | null = null;
  let unlisten: (() => void) | null = null;

  const hear = (event: PageEvent) => {
    if (state === null) return;
    const step = wakeStep(state, event, page.now());
    state = step.state;
    for (const signal of step.signals) for (const listener of listeners) listener(signal);
  };

  return {
    hidden: () => state?.hidden ?? page.hidden(),
    online: () => state?.online ?? page.online(),
    listen: (listener) => {
      listeners.add(listener);
      if (unlisten === null) {
        state = initialWakeState({ hidden: page.hidden(), online: page.online() }, page.now());
        unlisten = page.listen(hear);
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        unlisten?.();
        unlisten = null;
        state = null;
      };
    },
  };
}
